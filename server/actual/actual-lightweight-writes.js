import { createClient } from "@libsql/client";
import {
  Timestamp,
  merkle,
  getClock,
} from "@actual-app/crdt";
import path from "path";
import {
  actualDataDir,
  findLocalBudgetDir,
  getActualConfig,
  pruneActualBudgetBackups,
} from "./actual-local-metadata.js";
import { withActualClockLock } from "./actual-clock-lock.js";
import {
  serializeValue,
  encodeSyncRequest,
  verifyEncodedSyncRequest,
} from "./actualCrdtWire.js";
import {
  serializeConditionsOrActions,
  scheduleConditions,
  scheduleJsonPathFields,
  findExistingSchedule,
} from "./scheduleMatchModel.js";
import {
  tableColumns,
  loadClock,
  insertRowQuery,
  updateRowQuery,
  messageInsertQuery,
  clockUpdateQuery,
  readMessagesSince,
  resolveAccount,
  resolveAccountId,
  resolvePayee,
  resolveTransferPayee,
  categoryExists,
  readSchedules,
} from "./actualWriteDb.js";
import {
  loginActual,
  postActualSync,
  readBudgetMetadata,
  saveBudgetMetadata,
} from "./actualSyncTransport.js";

const TRANSACTION_SORT_INCREMENT = 65_536;

function unsupported(message) {
  return Object.assign(new Error(message), {
    status: 503,
    code: "ACTUAL_LIGHTWEIGHT_UNSUPPORTED",
  });
}

function actualDateInt(value) {
  const n = Number(String(value || "").replace(/-/g, ""));
  // A valid Actual date is a YYYYMMDD integer. Throw on NaN/implausible input so a
  // bad date can never be serialized (as N:NaN) into a local row or CRDT message.
  if (!Number.isFinite(n) || n < 10000101 || n > 99991231) {
    throw Object.assign(new Error(`Invalid Actual date: ${JSON.stringify(value)}`), { status: 400 });
  }
  return n;
}

function todayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
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

function computeSyncSince(metadata) {
  // Push everything not known-synced. Falling back to epoch 0 (not a 5-minute
  // wall-clock window) guarantees no locally-applied-but-unsynced message is
  // skipped when lastSyncedTimestamp is absent (a freshly-hydrated budget) —
  // lastPushedTimestamp bounds the window after the first successful push.
  return metadata.lastSyncedTimestamp
    || metadata.lastPushedTimestamp
    || new Timestamp(0, 0, "0").toString();
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
      const since = computeSyncSince(metadata);
      const messages = await readMessagesSince(client, since);
      const token = await loginActual(config);
      const syncResult = await postActualSync(config, token, { metadata, messages });
      // Record how far we've pushed so the next write's `since` window starts here.
      // Mutate the in-memory metadata first so maybeUpdateLastSyncedTimestamp's
      // spread of `...metadata` preserves it rather than clobbering it.
      metadata.lastPushedTimestamp = getClock().timestamp.toString();
      await saveBudgetMetadata(local.budgetDir, metadata).catch((err) => {
        console.warn("[EA] Actual lightweight lastPushedTimestamp persist failed:", err.message);
      });
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
  // The serializing lock lives in the shared withActualClockLock
  // (server/actual/actual-clock-lock.js) so the metadata-refresh path serializes
  // against lightweight writes on the same process-global crdt clock. Do not
  // reintroduce a private lock here.
  return withActualClockLock(() => sendBillLightweightInner(userId, billData, options));
}

export const __testing__ = {
  actualDateInt,
  computeSyncSince,
  encodeSyncRequest,
  findExistingSchedule,
  normalizeSupportedBillType,
  serializeValue,
  verifyEncodedSyncRequest,
};
