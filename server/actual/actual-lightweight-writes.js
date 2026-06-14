import { createClient } from "@libsql/client";
import {
  MessageEnvelopeSchema,
  MessageSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  Timestamp,
  create,
  deserializeClock,
  fromBinary,
  makeClientId,
  makeClock,
  merkle,
  serializeClock,
  setClock,
  getClock,
  toBinary,
} from "@actual-app/crdt";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import {
  actualDataDir,
  findLocalBudgetDir,
  getActualConfig,
  pruneActualBudgetBackups,
} from "./actual-local-metadata.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const TRANSACTION_SORT_INCREMENT = 65_536;
const SCHEDULE_FIELD_MAP = {
  account: "acct",
  payee: "description",
};
let lightweightWriteLock = Promise.resolve();

function unsupported(message) {
  return Object.assign(new Error(message), {
    status: 503,
    code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
  });
}

function actualDateInt(value) {
  return Number(String(value || "").replace(/-/g, ""));
}

function todayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function timeoutMs() {
  const value = Number(process.env.EA_ACTUAL_LIGHTWEIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function serializeValue(value) {
  if (value === null) return "0:";
  if (typeof value === "number") return `N:${value}`;
  if (typeof value === "string") return `S:${value}`;
  throw new Error(`Unserializable Actual value: ${JSON.stringify(value)}`);
}

function encodeSyncRequest({ groupId, cloudFileId, since, messages }) {
  const requestPb = create(SyncRequestSchema, {
    messages: messages.map((message) => create(MessageEnvelopeSchema, {
      timestamp: String(message.timestamp),
      isEncrypted: false,
      content: toBinary(MessageSchema, create(MessageSchema, {
        dataset: message.dataset,
        row: message.row,
        column: message.column,
        value: message.value,
      })),
    })),
    groupId,
    fileId: cloudFileId,
    since: String(since),
  });
  return toBinary(SyncRequestSchema, requestPb);
}

function syncPayloadSummary(messages) {
  const datasets = {};
  for (const message of messages) {
    datasets[message.dataset] = (datasets[message.dataset] || 0) + 1;
  }
  return datasets;
}

// The sync payload is hand-assembled protobuf; a silent @actual-app/crdt wire
// format change would corrupt writes without an error. Decode the encoded
// request and compare it field-by-field against the input so drift fails loudly
// before anything is sent.
function verifyEncodedSyncRequest(buffer, { groupId, cloudFileId, since, messages }) {
  const decoded = fromBinary(SyncRequestSchema, buffer);
  const problems = [];
  if (decoded.groupId !== groupId) problems.push("groupId");
  if (decoded.fileId !== cloudFileId) problems.push("fileId");
  if (decoded.since !== String(since)) problems.push("since");
  const envelopes = decoded.messages;
  if (envelopes.length !== messages.length) {
    problems.push(`messageCount (${envelopes.length} != ${messages.length})`);
  } else {
    envelopes.forEach((envelope, index) => {
      const expected = messages[index];
      const content = fromBinary(MessageSchema, envelope.content);
      if (
        envelope.timestamp !== String(expected.timestamp)
        || content.dataset !== expected.dataset
        || content.row !== expected.row
        || content.column !== expected.column
        || content.value !== expected.value
      ) {
        problems.push(`message[${index}] (${expected.dataset}.${expected.column})`);
      }
    });
  }
  if (problems.length) {
    throw Object.assign(
      new Error(`Actual lightweight sync payload failed its encode self-check (${problems.join(", ")}); the @actual-app/crdt wire format may have drifted`),
      { status: 500, code: "ACTUAL_LIGHTWEIGHT_PAYLOAD_DRIFT" },
    );
  }
}

async function fetchActualJson(url, { token = null, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response;
  let text = "";
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-ACTUAL-TOKEN": token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = await response.text();
  } catch (err) {
    throw Object.assign(new Error(err?.name === "AbortError"
      ? "Actual Budget lightweight write request timed out"
      : "Actual Budget server is unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error(`Actual Budget returned non-JSON response: ${text.slice(0, 120)}`), { status: 502 });
  }
}

async function loginActual(config) {
  if (!config.password) {
    throw Object.assign(new Error("Actual Budget password is required for lightweight writes"), { status: 400 });
  }
  const login = await fetchActualJson(`${config.serverURL}/account/login`, {
    body: { password: config.password, loginMethod: "password" },
  });
  const token = login?.data?.token;
  if (!token) throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  return token;
}

async function postActualSync(config, token, { metadata, messages }) {
  const since = metadata.lastSyncedTimestamp
    || new Timestamp(Date.now() - 5 * 60 * 1000, 0, "0").toString();
  const payload = {
    groupId: metadata.groupId,
    cloudFileId: metadata.cloudFileId,
    since,
    messages,
  };
  const buffer = encodeSyncRequest(payload);
  verifyEncodedSyncRequest(buffer, payload);
  console.log(`[EA] Actual lightweight sync: pushing ${messages.length} message(s) ${JSON.stringify(syncPayloadSummary(messages))} since ${since}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${config.serverURL}/sync/sync`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Length": String(buffer.length),
        "Content-Type": "application/actual-sync",
        "X-ACTUAL-TOKEN": token,
      },
      body: buffer,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(`Actual Budget lightweight sync failed: ${text.slice(0, 120) || response.status}`), {
        status: response.status >= 500 ? 502 : 400,
      });
    }
    const responseBuffer = await response.arrayBuffer();
    const responsePb = fromBinary(SyncResponseSchema, new Uint8Array(responseBuffer));
    const merkleText = responsePb.merkle;
    return {
      messageCount: responsePb.messages.length,
      merkle: merkleText ? JSON.parse(merkleText) : null,
    };
  } catch (err) {
    if (err?.status) throw err;
    throw Object.assign(new Error(err?.name === "AbortError"
      ? "Actual Budget lightweight sync timed out"
      : "Actual Budget lightweight sync failed"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function saveBudgetMetadata(budgetDir, metadata) {
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify(metadata));
}

function quoteIdent(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Actual DB identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function tableColumns(client, table) {
  const result = await client.execute(`PRAGMA table_info(${quoteIdent(table)})`);
  return new Set((result.rows || []).map((row) => row.name));
}

async function readBudgetMetadata(budgetDir) {
  return JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8"));
}

async function loadClock(client) {
  const result = await client.execute("SELECT clock FROM messages_clock WHERE id = 1");
  const clockText = result.rows?.[0]?.clock;
  const clock = clockText
    ? deserializeClock(clockText)
    : makeClock(new Timestamp(0, 0, makeClientId()));
  setClock(clock);
}

function makeMessages(dataset, row, fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([column, value]) => ({
      dataset,
      row,
      column,
      value: serializeValue(value),
      rawValue: value,
      timestamp: Timestamp.send(),
    }));
}

function insertRowQuery(table, id, fields, columns) {
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([column, value]) => value !== undefined && value !== null && columns.has(column)),
  );
  const names = ["id", ...Object.keys(filtered)];
  return {
    sql: `INSERT INTO ${quoteIdent(table)} (${names.map(quoteIdent).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    args: [id, ...Object.values(filtered)],
    messages: makeMessages(table, id, filtered),
  };
}

function updateRowQuery(table, id, fields, columns) {
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([column, value]) => value !== undefined && value !== null && columns.has(column)),
  );
  const names = Object.keys(filtered);
  if (!names.length) return null;
  return {
    sql: `UPDATE ${quoteIdent(table)} SET ${names.map((name) => `${quoteIdent(name)} = ?`).join(", ")} WHERE id = ?`,
    args: [...Object.values(filtered), id],
    messages: makeMessages(table, id, filtered),
  };
}

function messageInsertQuery(message) {
  return {
    sql: `INSERT INTO messages_crdt (timestamp, dataset, row, column, value)
          VALUES (?, ?, ?, ?, ?)`,
    args: [String(message.timestamp), message.dataset, message.row, message.column, message.value],
  };
}

function clockUpdateQuery(messages) {
  let currentMerkle = getClock().merkle;
  for (const message of messages) {
    currentMerkle = merkle.insert(currentMerkle, message.timestamp);
  }
  currentMerkle = merkle.prune(currentMerkle);
  const nextClock = { ...getClock(), merkle: currentMerkle };
  setClock(nextClock);
  return {
    sql: "INSERT OR REPLACE INTO messages_clock (id, clock) VALUES (1, ?)",
    args: [serializeClock(nextClock)],
  };
}

async function resolveAccount(client, billData) {
  const result = await client.execute(
    `SELECT id, name, type
     FROM accounts
     WHERE COALESCE(closed, 0) = 0 AND COALESCE(tombstone, 0) = 0
     ORDER BY name COLLATE NOCASE`,
  );
  const accounts = result.rows || [];
  if (billData.account_id) {
    const selected = accounts.find((account) => account.id === billData.account_id);
    if (selected) return selected;
    throw Object.assign(new Error("Selected Actual account was not found in the local cache"), { status: 400 });
  }
  const fallback = accounts.find((account) =>
    account.type === "checking" || String(account.name || "").toLowerCase().includes("checking"),
  ) || accounts[0];
  if (!fallback) throw Object.assign(new Error("No open Actual account was found in the local cache"), { status: 400 });
  return fallback;
}

async function resolveAccountId(client, accountId, label) {
  if (!accountId) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  const result = await client.execute({
    sql: `SELECT id, name, type
          FROM accounts
          WHERE id = ?
            AND COALESCE(closed, 0) = 0
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [accountId],
  });
  const account = result.rows?.[0];
  if (!account) {
    throw Object.assign(new Error(`${label} was not found in the local cache`), { status: 400 });
  }
  return account;
}

async function resolvePayee(client, payeeName) {
  const name = String(payeeName || "").trim();
  if (!name) throw Object.assign(new Error("payee is required"), { status: 400 });
  const existing = await client.execute({
    sql: `SELECT id
          FROM payees
          WHERE LOWER(name) = LOWER(?)
            AND transfer_acct IS NULL
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [name],
  });
  const existingId = existing.rows?.[0]?.id;
  if (existingId) return { id: existingId, created: false, name };
  return { id: crypto.randomUUID(), created: true, name };
}

async function resolveTransferPayee(client, fromAccountId) {
  if (!fromAccountId) {
    throw Object.assign(new Error("Transfer requires from_account_id"), { status: 400 });
  }
  const result = await client.execute({
    sql: `SELECT id, name, transfer_acct
          FROM payees
          WHERE transfer_acct = ?
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [fromAccountId],
  });
  const payee = result.rows?.[0];
  if (!payee) {
    throw Object.assign(new Error("No transfer payee found for selected source account in the local cache"), {
      status: 400,
    });
  }
  return { ...payee, created: false };
}

async function categoryExists(client, categoryId) {
  if (!categoryId) return false;
  const result = await client.execute({
    sql: "SELECT id FROM categories WHERE id = ? AND COALESCE(tombstone, 0) = 0 LIMIT 1",
    args: [categoryId],
  });
  return Boolean(result.rows?.length);
}

function transactionFields({ billData, account, payee, type, now }) {
  const amountCents = Math.round(Number(billData.amount) * 100);
  const isIncome = type === "income";
  const isPastBill = type === "bill";
  return {
    acct: account.id,
    amount: isIncome ? Math.abs(amountCents) : -Math.abs(amountCents),
    description: payee.id,
    notes: billData.notes == null || String(billData.notes).trim() === "" ? "" : String(billData.notes),
    date: actualDateInt(billData.due_date),
    category: billData.category_id || undefined,
    cleared: isPastBill ? 0 : 1,
    sort_order: now,
    raw_synced_data: JSON.stringify({
      imported_payee: payee.name,
      date: billData.due_date,
      amount: isIncome ? Math.abs(amountCents) : -Math.abs(amountCents),
    }),
  };
}

function resolveWriteMode(billData, { now = new Date() } = {}) {
  const type = billData?.type || "expense";
  if (type === "expense" || type === "income") return { type, mode: "transaction" };
  if (type === "bill" && billData.due_date <= todayYmd(now)) return { type, mode: "transaction" };
  if (type === "bill") return { type, mode: "schedule" };
  if (type === "transfer" && billData.due_date > todayYmd(now)) {
    return { type, mode: "schedule" };
  }
  if (type === "transfer") {
    throw unsupported("Past-due transfer transactions require Actual transfer-link validation; create this transfer directly in Actual or enable SDK fallback.");
  }
  throw Object.assign(new Error(`Unsupported Actual bill type: ${type}`), { status: 400 });
}

function normalizeSupportedBillType(billData, options = {}) {
  return resolveWriteMode(billData, options).type;
}

async function readMessagesSince(client, since) {
  const result = await client.execute({
    sql: `SELECT timestamp, dataset, row, column, value
          FROM messages_crdt
          WHERE timestamp > ?
          ORDER BY timestamp ASC`,
    args: [since],
  });
  return result.rows.map((row) => ({
    timestamp: row.timestamp,
    dataset: row.dataset,
    row: row.row,
    column: row.column,
    value: row.value,
  }));
}

function internalScheduleCondition(condition) {
  return {
    ...condition,
    field: SCHEDULE_FIELD_MAP[condition.field] || condition.field,
  };
}

function serializeConditionsOrActions(items) {
  return JSON.stringify(items.map((item) => (item.field ? internalScheduleCondition(item) : item)));
}

function conditionForFields(conditions, fields, ops = null) {
  return conditions.find((condition) =>
    fields.includes(condition.field)
      && (!ops || ops.includes(condition.op))
  ) || null;
}

function conditionAmountCents(condition) {
  const value = condition?.value;
  if (typeof value === "object" && value !== null) return value.num1 ?? value.num2 ?? 0;
  return Number(value || 0);
}

function scheduleAmountMatches(condition, amountCents) {
  if (!condition || !amountCents) return false;
  const amount = Math.abs(amountCents);
  if (condition.op === "is") return Math.abs(conditionAmountCents(condition)) === amount;
  if (condition.op === "isapprox") return Math.abs(Math.abs(conditionAmountCents(condition)) - amount) / amount < 0.3;
  if (condition.op === "isbetween" && typeof condition.value === "object" && condition.value !== null) {
    const lo = Math.min(Math.abs(condition.value.num1 || 0), Math.abs(condition.value.num2 || 0));
    const hi = Math.max(Math.abs(condition.value.num1 || 0), Math.abs(condition.value.num2 || 0));
    return amount >= lo * 0.7 && amount <= hi * 1.3;
  }
  return false;
}

function parseScheduleConditions(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

async function readSchedules(client, scheduleColumns) {
  const nameSelect = scheduleColumns.has("name") ? "s.name" : "NULL AS name";
  const result = await client.execute(
    `SELECT s.id, ${nameSelect}, s.rule, s.completed,
            r.conditions, r.actions, r.conditions_op, nd.id AS next_date_id
     FROM schedules s
     LEFT JOIN rules r ON r.id = s.rule
     LEFT JOIN schedules_next_date nd ON nd.schedule_id = s.id
     WHERE COALESCE(s.tombstone, 0) = 0`,
  );
  return result.rows.map((row) => ({
    ...row,
    conditions: parseScheduleConditions(row.conditions),
  }));
}

function findExistingSchedule(schedules, payeeId, accountId, amountCents, name) {
  if (payeeId) {
    const payeeMatches = schedules.filter((schedule) =>
      conditionForFields(schedule.conditions, ["payee", "description"])?.value === payeeId
    );
    const accountMatches = accountId
      ? payeeMatches.filter((schedule) =>
        conditionForFields(schedule.conditions, ["account", "acct"])?.value === accountId
      )
      : payeeMatches;
    if (accountMatches.length === 1) return accountMatches[0];
    if (accountMatches.length > 1) {
      const amountMatch = accountMatches.find((schedule) =>
        scheduleAmountMatches(
          conditionForFields(schedule.conditions, ["amount"], ["is", "isapprox", "isbetween"]),
          amountCents,
        )
      );
      return amountMatch || accountMatches[0];
    }
  }
  if (name) {
    return schedules.find((schedule) => schedule.name === name) || null;
  }
  return null;
}

function scheduleConditions({ dueDate, amountCents, payeeId, accountId }) {
  return [
    { op: "is", field: "date", value: dueDate },
    { op: "is", field: "amount", value: amountCents },
    payeeId ? { op: "is", field: "payee", value: payeeId } : null,
    accountId ? { op: "is", field: "account", value: accountId } : null,
  ].filter(Boolean);
}

function scheduleJsonPathFields(conditions) {
  const internalConditions = conditions.map(internalScheduleCondition);
  const pathFor = (fields, ops = null) => {
    const index = internalConditions.findIndex((condition) =>
      fields.includes(condition.field)
        && (!ops || ops.includes(condition.op))
    );
    return index === -1 ? null : `$[${index}]`;
  };
  return {
    payee: pathFor(["payee", "description"], ["is"]),
    account: pathFor(["account", "acct"], ["is"]),
    amount: pathFor(["amount"], ["is", "isapprox", "isbetween"]),
    date: pathFor(["date"], ["is", "isapprox"]),
  };
}

function scheduleJsonPathsQuery(scheduleId, conditions) {
  const paths = scheduleJsonPathFields(conditions);
  return {
    sql: `INSERT OR REPLACE INTO schedules_json_paths (schedule_id, payee, account, amount, date)
          VALUES (?, ?, ?, ?, ?)`,
    args: [scheduleId, paths.payee, paths.account, paths.amount, paths.date],
  };
}

function ruleFields(scheduleId, conditions) {
  return {
    stage: null,
    conditions: serializeConditionsOrActions(conditions),
    actions: serializeConditionsOrActions([{ op: "link-schedule", value: scheduleId }]),
    conditions_op: "and",
    tombstone: 0,
  };
}

function scheduleNextDateFields(scheduleId, dueDate, nowMs) {
  const nextDate = actualDateInt(dueDate);
  return {
    schedule_id: scheduleId,
    local_next_date: nextDate,
    local_next_date_ts: nowMs,
    base_next_date: nextDate,
    base_next_date_ts: nowMs,
    tombstone: 0,
  };
}

function scheduleRowFields(ruleId, name) {
  return {
    rule: ruleId,
    active: 0,
    completed: 0,
    posts_transaction: 0,
    tombstone: 0,
    name,
  };
}

function createScheduleRows({ name, conditions, dueDate, columns, nowMs }) {
  const scheduleId = crypto.randomUUID();
  const ruleId = crypto.randomUUID();
  const nextDateId = crypto.randomUUID();
  const rows = [
    insertRowQuery("rules", ruleId, ruleFields(scheduleId, conditions), columns.rules),
    insertRowQuery(
      "schedules_next_date",
      nextDateId,
      scheduleNextDateFields(scheduleId, dueDate, nowMs),
      columns.schedulesNextDate,
    ),
    insertRowQuery("schedules", scheduleId, scheduleRowFields(ruleId, name), columns.schedules),
  ];
  return { scheduleId, reused: false, rows };
}

function updateScheduleRows(existing, { name, conditions, dueDate, columns, nowMs }) {
  const rows = [];
  let ruleId = existing.rule;
  if (ruleId) {
    rows.push(updateRowQuery("rules", ruleId, ruleFields(existing.id, conditions), columns.rules));
  } else {
    ruleId = crypto.randomUUID();
    rows.push(insertRowQuery("rules", ruleId, ruleFields(existing.id, conditions), columns.rules));
  }

  const scheduleFields = {
    rule: ruleId,
    completed: 0,
    name: name || existing.name || null,
  };
  rows.push(updateRowQuery("schedules", existing.id, scheduleFields, columns.schedules));

  if (existing.next_date_id) {
    rows.push(updateRowQuery(
      "schedules_next_date",
      existing.next_date_id,
      scheduleNextDateFields(existing.id, dueDate, nowMs),
      columns.schedulesNextDate,
    ));
  } else {
    rows.push(insertRowQuery(
      "schedules_next_date",
      crypto.randomUUID(),
      scheduleNextDateFields(existing.id, dueDate, nowMs),
      columns.schedulesNextDate,
    ));
  }

  return { scheduleId: existing.id, reused: true, rows: rows.filter(Boolean) };
}

async function buildScheduleWrite(client, billData, { type, now, columns }) {
  const amountCents = Math.round(Number(billData.amount) * 100);
  if (!Number.isFinite(amountCents)) {
    throw Object.assign(new Error("amount is required"), { status: 400 });
  }

  let name;
  let accountId;
  let payeeId;
  let payeeRows = [];
  let message;

  if (type === "transfer") {
    if (!billData.to_account_id || !billData.schedule_name) {
      throw Object.assign(new Error("Transfer requires to_account_id and schedule_name"), { status: 400 });
    }
    await resolveAccountId(client, billData.from_account_id, "Transfer source account");
    const toAccount = await resolveAccountId(client, billData.to_account_id, "Transfer destination account");
    const transferPayee = await resolveTransferPayee(client, billData.from_account_id);
    name = String(billData.schedule_name || "").trim();
    accountId = toAccount.id;
    payeeId = transferPayee.id;
    message = (reused) => reused
      ? `Updated transfer schedule "${name}"`
      : `Transfer schedule "${name}" created`;
  } else {
    const account = await resolveAccount(client, billData);
    const payee = await resolvePayee(client, billData.payee);
    if (payee.created) {
      payeeRows = [
        insertRowQuery("payees", payee.id, { name: payee.name }, columns.payees),
        insertRowQuery("payee_mapping", payee.id, { targetId: payee.id }, columns.payeeMapping),
      ];
    }
    name = payee.name;
    accountId = account.id;
    payeeId = payee.id;
    message = (reused) => reused
      ? `Updated schedule "${name}"`
      : `Schedule "${name}" created`;
  }

  if (!name) throw Object.assign(new Error("schedule_name is required"), { status: 400 });

  const signedAmount = type === "income" ? Math.abs(amountCents) : -Math.abs(amountCents);
  const amount = type === "transfer" ? Math.abs(amountCents) : signedAmount;
  const conditions = scheduleConditions({
    dueDate: billData.due_date,
    amountCents: amount,
    payeeId,
    accountId,
  });
  const schedules = await readSchedules(client, columns.schedules);
  const existing = findExistingSchedule(schedules, payeeId, accountId, amount, name);
  const scheduleWrite = existing
    ? updateScheduleRows(existing, { name, conditions, dueDate: billData.due_date, columns, nowMs: now.getTime() })
    : createScheduleRows({ name, conditions, dueDate: billData.due_date, columns, nowMs: now.getTime() });

  return {
    scheduleId: scheduleWrite.scheduleId,
    rows: [...payeeRows, ...scheduleWrite.rows],
    sideEffectRows: [scheduleJsonPathsQuery(scheduleWrite.scheduleId, conditions)],
    message: message(scheduleWrite.reused),
  };
}

async function maybeUpdateLastSyncedTimestamp(budgetDir, metadata, syncResult) {
  if (!syncResult?.merkle || syncResult.messageCount !== 0) return;
  if (merkle.diff(syncResult.merkle, getClock().merkle) !== null) return;
  const nextMetadata = {
    ...metadata,
    lastSyncedTimestamp: getClock().timestamp.toString(),
  };
  await saveBudgetMetadata(budgetDir, nextMetadata);
}

async function sendBillLightweightInner(userId, billData, { now = new Date(), dbClient } = {}) {
  const { type, mode } = resolveWriteMode(billData, { now });
  const config = await getActualConfig(userId, { dbClient });
  const dataDir = actualDataDir();
  const local = await findLocalBudgetDir(config.syncId, { dataDir });
  if (!local?.budgetDir) {
    throw Object.assign(new Error("Actual local budget cache is unavailable; hydrate the cache before using lightweight Bill Pay writes"), {
      status: 503,
      code: "ACTUAL_LOCAL_BUDGET_REQUIRED",
    });
  }

  const metadata = await readBudgetMetadata(local.budgetDir);
  if (metadata.encryptKeyId) {
    throw unsupported("Encrypted Actual budgets are not supported by lightweight Bill Pay writes.");
  }

  const client = createClient({ url: `file:${path.join(local.budgetDir, "db.sqlite")}` });
  try {
    await loadClock(client);
    const [
      transactionColumns,
      payeeColumns,
      payeeMappingColumns,
      rulesColumns,
      schedulesColumns,
      schedulesNextDateColumns,
    ] = await Promise.all([
      tableColumns(client, "transactions"),
      tableColumns(client, "payees"),
      tableColumns(client, "payee_mapping"),
      tableColumns(client, "rules"),
      tableColumns(client, "schedules"),
      tableColumns(client, "schedules_next_date"),
    ]);
    if (billData.category_id && !(await categoryExists(client, billData.category_id))) {
      throw Object.assign(new Error("Selected Actual category was not found in the local cache"), { status: 400 });
    }

    let rows = [];
    let sideEffectRows = [];
    let returnPayload;

    if (mode === "schedule") {
      const scheduleWrite = await buildScheduleWrite(client, billData, {
        type,
        now,
        columns: {
          payees: payeeColumns,
          payeeMapping: payeeMappingColumns,
          rules: rulesColumns,
          schedules: schedulesColumns,
          schedulesNextDate: schedulesNextDateColumns,
        },
      });
      rows = scheduleWrite.rows;
      sideEffectRows = scheduleWrite.sideEffectRows;
      returnPayload = {
        success: true,
        message: scheduleWrite.message,
        scheduleId: scheduleWrite.scheduleId,
        lightweight: true,
      };
    } else {
      const account = await resolveAccount(client, billData);
      const payee = await resolvePayee(client, billData.payee);
      if (payee.created) {
        rows.push(insertRowQuery("payees", payee.id, { name: payee.name }, payeeColumns));
        rows.push(insertRowQuery("payee_mapping", payee.id, { targetId: payee.id }, payeeMappingColumns));
      }
      const transactionId = crypto.randomUUID();
      rows.push(insertRowQuery("transactions", transactionId, transactionFields({
        billData,
        account,
        payee,
        type,
        now: now.getTime(),
      }), transactionColumns));
      returnPayload = {
        success: true,
        message: type === "bill"
          ? `Transaction "${billData.payee}" created (date is today or past)`
          : `Sent ${billData.payee} $${billData.amount} to Actual Budget`,
        transactionId,
        lightweight: true,
      };
    }

    const localMessages = rows.flatMap((row) => row.messages);
    await client.batch([
      ...rows.map(({ sql, args }) => ({ sql, args })),
      ...sideEffectRows,
      ...localMessages.map(messageInsertQuery),
      clockUpdateQuery(localMessages),
    ]);

    // From this point the write exists in the local budget copy. A failure
    // while pushing to the Actual server is recoverable — the unsynced CRDT
    // messages are re-sent on the next successful sync because
    // lastSyncedTimestamp is only advanced after the push — but the write must
    // NOT be retried (locally or via the SDK fallback) or it would duplicate.
    try {
      const since = metadata.lastSyncedTimestamp
        || new Timestamp(Date.now() - 5 * 60 * 1000, 0, "0").toString();
      const messages = await readMessagesSince(client, since);
      const token = await loginActual(config);
      const syncResult = await postActualSync(config, token, { metadata, messages });
      await maybeUpdateLastSyncedTimestamp(local.budgetDir, metadata, syncResult).catch((err) => {
        console.warn("[EA] Actual lightweight sync timestamp update failed:", err.message);
      });
      await pruneActualBudgetBackups(local.budgetDir).catch((err) => {
        console.warn("[EA] Actual local backup pruning failed:", err.message);
      });
    } catch (err) {
      console.error(
        `[EA] Actual lightweight sync failed after the local write was applied (${rows.length} row(s) committed locally; they will re-sync on the next successful sync):`,
        err.message,
      );
      throw Object.assign(err, {
        code: err.code || "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
        localWriteApplied: true,
      });
    }

    return returnPayload;
  } finally {
    await client.close();
  }
}

export function sendBillLightweight(userId, billData, options = {}) {
  const run = () => sendBillLightweightInner(userId, billData, options);
  const result = lightweightWriteLock.then(run, run);
  lightweightWriteLock = result.catch(() => {});
  return result;
}

export const __testing__ = {
  encodeSyncRequest,
  normalizeSupportedBillType,
  serializeValue,
  verifyEncodedSyncRequest,
};
