import {
  sendBill as actualSendBill,
  markBillPaid as actualMarkBillPaid,
  getAccounts as actualGetAccounts,
  getCategories as actualGetCategories,
  getPayees as actualGetPayees,
  getMetadata as actualGetMetadata,
  getCalendarBillsRange as actualGetCalendarBillsRange,
  testConnection as actualTestConnection,
  createQuickTxn as actualCreateQuickTxn,
} from "./actual.js";
import { trimBillBody } from "./bill-extract.js";
import db from "../db/connection.js";
import { ANTHROPIC_PROVIDER } from "./bill-extractors/anthropic.js";
import { OPENAI_PROVIDER } from "./bill-extractors/openai.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  isAllowedBillExtractModel,
} from "./bill-extractors/catalog.js";

const PROVIDERS = {
  [ANTHROPIC_PROVIDER.id]: ANTHROPIC_PROVIDER,
  [OPENAI_PROVIDER.id]: OPENAI_PROVIDER,
};
const BILL_MIRROR_REFRESH_RANGE = { start: "1900-01-01", end: "9999-12-31" };
const BILLS_MIRROR_REFRESH_TIMERS = new Map();
let billsMirrorRefreshWorkerTimer = null;

function isoNow(now = new Date()) {
  return now.toISOString();
}

function boolFromDb(value) {
  return value === true || value === 1 || value === "1";
}

function mirrorStateFromRow(row) {
  if (!row) {
    return {
      state: "needs_sync",
      configured: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      pendingRefreshAt: null,
      refreshStartedAt: null,
    };
  }
  return {
    state: row.status || "needs_sync",
    configured: boolFromDb(row.actual_configured),
    lastSuccessAt: row.last_success_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    lastError: row.last_error || null,
    pendingRefreshAt: row.pending_refresh_at || null,
    refreshStartedAt: row.refresh_started_at || null,
  };
}

function occurrenceFromRow(row) {
  return {
    id: row.occurrence_id,
    scheduleId: row.schedule_id,
    name: row.name || row.payee || "Unknown",
    payee: row.payee || row.name || "Unknown",
    amount: Number(row.amount || 0),
    next_date: row.occurrence_date,
    paid: boolFromDb(row.paid),
    type: row.type || "bill",
    openActionDisabled: boolFromDb(row.open_action_disabled),
  };
}

function normalizeMirrorOccurrence(schedule) {
  const scheduleId = schedule.scheduleId || schedule.schedule_id || schedule.id;
  const date = schedule.next_date || schedule.occurrence_date;
  const occurrenceId = schedule.id && String(schedule.id).includes(":")
    ? String(schedule.id)
    : `${scheduleId}:${date}`;
  return {
    id: occurrenceId,
    scheduleId,
    name: schedule.name || schedule.payee || "Unknown",
    payee: schedule.payee || schedule.name || "Unknown",
    amount: Number(schedule.amount || 0),
    next_date: date,
    paid: !!schedule.paid,
    type: schedule.type || "bill",
    openActionDisabled: !!schedule.openActionDisabled,
  };
}

function scheduleMirrorArgs(userId, occurrence, timestamp) {
  return [
    userId,
    occurrence.scheduleId,
    occurrence.name,
    occurrence.payee,
    occurrence.amount,
    occurrence.type,
    occurrence.next_date,
    occurrence.paid ? 1 : 0,
    JSON.stringify(occurrence),
    timestamp,
  ];
}

function occurrenceMirrorArgs(userId, occurrence, timestamp) {
  return [
    userId,
    occurrence.id,
    occurrence.scheduleId,
    occurrence.next_date,
    occurrence.name,
    occurrence.payee,
    occurrence.amount,
    occurrence.type,
    occurrence.paid ? 1 : 0,
    occurrence.openActionDisabled ? 1 : 0,
    JSON.stringify(occurrence),
    timestamp,
  ];
}

function currentPayloadFromOccurrences(occurrences, {
  actualBudgetUrl = null,
  actualConfigured = false,
  syncHealth,
  now = new Date(),
} = {}) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const bills = occurrences.filter((occurrence) =>
    occurrence.next_date >= today && occurrence.next_date <= weekFromNow,
  );
  return {
    bills,
    allSchedules: occurrences,
    payeeMap: {},
    actualConfigured,
    actualBudgetUrl,
    syncHealth,
    billsSyncHealth: syncHealth,
  };
}

async function loadActualBudgetUrl(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: "SELECT actual_budget_url FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  return result.rows?.[0]?.actual_budget_url || null;
}

function clearBillsMirrorTimer(userId) {
  const timer = BILLS_MIRROR_REFRESH_TIMERS.get(userId);
  if (timer) clearTimeout(timer);
  BILLS_MIRROR_REFRESH_TIMERS.delete(userId);
}

function armBillsMirrorTimer(userId, dueAtIso) {
  clearBillsMirrorTimer(userId);
  const delayMs = Math.max(0, new Date(dueAtIso).getTime() - Date.now());
  const timer = setTimeout(() => {
    BILLS_MIRROR_REFRESH_TIMERS.delete(userId);
    runDueBillsMirrorRefresh(userId).catch((err) => {
      console.error("[EA] Bills mirror delayed refresh failed:", err.message);
    });
  }, delayMs);
  timer.unref?.();
  BILLS_MIRROR_REFRESH_TIMERS.set(userId, timer);
}

async function loadBillExtractChoice(userId) {
  try {
    const result = await db.execute({
      sql: "SELECT bill_extract_provider, bill_extract_model FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    const row = result.rows?.[0] || {};
    let provider = row.bill_extract_provider || DEFAULT_BILL_EXTRACT_PROVIDER;
    let model = row.bill_extract_model || DEFAULT_BILL_EXTRACT_MODEL;
    if (!isAllowedBillExtractModel(provider, model)) {
      provider = DEFAULT_BILL_EXTRACT_PROVIDER;
      model = DEFAULT_BILL_EXTRACT_MODEL;
    }
    return { provider, model };
  } catch {
    return { provider: DEFAULT_BILL_EXTRACT_PROVIDER, model: DEFAULT_BILL_EXTRACT_MODEL };
  }
}

export async function sendBill(userId, billData) {
  const result = await actualSendBill(billData, userId);
  await scheduleBillsMirrorRefresh(userId, { delayMs: 60_000 }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
  });
  return result;
}

export async function markBillPaid(userId, billId) {
  const result = await actualMarkBillPaid(billId, userId);
  await scheduleBillsMirrorRefresh(userId, { delayMs: 60_000 }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
  });
  return result;
}

export async function listAccounts(userId) {
  return actualGetAccounts(userId);
}

export async function listCategories(userId) {
  return actualGetCategories(userId);
}

export async function listPayees(userId) {
  return actualGetPayees(userId);
}

export async function getMetadata(userId) {
  return actualGetMetadata(userId);
}

export async function testConnection(userId, overrides) {
  return actualTestConnection(userId, overrides);
}

export async function createQuickTxn(userId, payload) {
  return actualCreateQuickTxn(userId, payload);
}

export async function getBillsMirrorState(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT status, actual_configured, actual_budget_url, last_success_at,
                 last_attempt_at, last_error, pending_refresh_at, refresh_started_at
          FROM ea_bills_mirror_state
          WHERE user_id = ?`,
    args: [userId],
  });
  const row = result.rows?.[0] || null;
  return {
    row,
    syncHealth: mirrorStateFromRow(row),
    actualBudgetUrl: row?.actual_budget_url || null,
  };
}

export async function readBillsMirrorRange(userId, { start, end }, { dbClient = db } = {}) {
  const [state, occurrences] = await Promise.all([
    getBillsMirrorState(userId, { dbClient }),
    dbClient.execute({
      sql: `SELECT occurrence_id, schedule_id, occurrence_date, name, payee, amount,
                   type, paid, open_action_disabled
            FROM ea_bill_occurrence_mirror
            WHERE user_id = ?
              AND occurrence_date >= ?
              AND occurrence_date <= ?
            ORDER BY occurrence_date ASC, name ASC`,
      args: [userId, start, end],
    }),
  ]);

  return {
    schedules: (occurrences.rows || []).map(occurrenceFromRow),
    recentTransactions: [],
    payeeMap: {},
    actualBudgetUrl: state.actualBudgetUrl,
    syncHealth: state.syncHealth,
  };
}

export async function readBillsMirrorCurrent(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const data = await readBillsMirrorRange(userId, { start: today, end: weekFromNow }, { dbClient });
  return {
    bills: data.schedules,
    allSchedules: data.schedules,
    payeeMap: data.payeeMap,
    actualConfigured: data.syncHealth.configured === true,
    actualBudgetUrl: data.actualBudgetUrl,
    billsSyncHealth: data.syncHealth,
  };
}

export async function scheduleBillsMirrorRefresh(userId, {
  delayMs = 0,
  dbClient = db,
  now = new Date(),
} = {}) {
  const dueAt = new Date(now.getTime() + delayMs).toISOString();
  const timestamp = isoNow(now);
  await dbClient.execute({
    sql: `INSERT INTO ea_bills_mirror_state
            (user_id, status, pending_refresh_at, updated_at)
          VALUES (?, 'needs_sync', ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            pending_refresh_at = CASE
              WHEN ea_bills_mirror_state.pending_refresh_at IS NULL THEN excluded.pending_refresh_at
              WHEN excluded.pending_refresh_at < ea_bills_mirror_state.pending_refresh_at THEN excluded.pending_refresh_at
              ELSE ea_bills_mirror_state.pending_refresh_at
            END,
            status = CASE
              WHEN ea_bills_mirror_state.status = 'current' THEN 'needs_sync'
              ELSE ea_bills_mirror_state.status
            END,
            updated_at = excluded.updated_at`,
    args: [userId, dueAt, timestamp],
  });
  if (dbClient === db) armBillsMirrorTimer(userId, dueAt);
  return { pendingRefreshAt: dueAt };
}

export async function consumeDueBillsMirrorRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const dueAt = isoNow(now);
  const result = await dbClient.execute({
    sql: `SELECT pending_refresh_at
          FROM ea_bills_mirror_state
          WHERE user_id = ?
            AND pending_refresh_at IS NOT NULL
            AND pending_refresh_at <= ?`,
    args: [userId, dueAt],
  });
  if (!result.rows?.length) return false;
  await dbClient.execute({
    sql: `UPDATE ea_bills_mirror_state
          SET pending_refresh_at = NULL,
              updated_at = ?
          WHERE user_id = ?`,
    args: [dueAt, userId],
  });
  if (dbClient === db) clearBillsMirrorTimer(userId);
  return true;
}

export async function clearPendingBillsMirrorRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  await dbClient.execute({
    sql: `UPDATE ea_bills_mirror_state
          SET pending_refresh_at = NULL,
              updated_at = ?
          WHERE user_id = ?`,
    args: [isoNow(now), userId],
  });
  if (dbClient === db) clearBillsMirrorTimer(userId);
}

export async function runDueBillsMirrorRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const due = await consumeDueBillsMirrorRefresh(userId, { dbClient, now });
  if (!due) return { refreshed: false };
  const actualBudgetUrl = await loadActualBudgetUrl(userId, { dbClient });
  const payload = await refreshBillsMirror(userId, { actualBudgetUrl, dbClient, now });
  return { refreshed: true, payload };
}

export function __resetBillsMirrorRefreshTimersForTests() {
  for (const timer of BILLS_MIRROR_REFRESH_TIMERS.values()) clearTimeout(timer);
  BILLS_MIRROR_REFRESH_TIMERS.clear();
  if (billsMirrorRefreshWorkerTimer) clearInterval(billsMirrorRefreshWorkerTimer);
  billsMirrorRefreshWorkerTimer = null;
}

export async function armPendingBillsMirrorRefreshes({
  dbClient = db,
  now = new Date(),
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT user_id, pending_refresh_at
          FROM ea_bills_mirror_state
          WHERE pending_refresh_at IS NOT NULL`,
    args: [],
  });
  const dueAt = now.toISOString();
  let dueCount = 0;
  let armedCount = 0;
  for (const row of result.rows || []) {
    if (row.pending_refresh_at <= dueAt) {
      dueCount += 1;
      runDueBillsMirrorRefresh(row.user_id, { dbClient, now }).catch((err) => {
        console.error("[EA] Bills mirror due refresh failed:", err.message);
      });
    } else if (dbClient === db) {
      armedCount += 1;
      armBillsMirrorTimer(row.user_id, row.pending_refresh_at);
    }
  }
  return { dueCount, armedCount };
}

export function startBillsMirrorRefreshWorker({
  dbClient = db,
  intervalMs = 5 * 60 * 1000,
} = {}) {
  if (billsMirrorRefreshWorkerTimer) return { started: false };
  armPendingBillsMirrorRefreshes({ dbClient }).catch((err) => {
    console.error("[EA] Bills mirror startup refresh check failed:", err.message);
  });
  billsMirrorRefreshWorkerTimer = setInterval(() => {
    armPendingBillsMirrorRefreshes({ dbClient }).catch((err) => {
      console.error("[EA] Bills mirror refresh worker failed:", err.message);
    });
  }, intervalMs);
  billsMirrorRefreshWorkerTimer.unref?.();
  return { started: true };
}

export async function refreshBillsMirror(userId, {
  actualBudgetUrl = null,
  dbClient = db,
  now = new Date(),
} = {}) {
  const timestamp = isoNow(now);
  if (!actualBudgetUrl) {
    await dbClient.batch([
      {
        sql: `DELETE FROM ea_bill_occurrence_mirror WHERE user_id = ?`,
        args: [userId],
      },
      {
        sql: `DELETE FROM ea_bill_schedule_mirror WHERE user_id = ?`,
        args: [userId],
      },
      {
        sql: `INSERT INTO ea_bills_mirror_state
                (user_id, status, actual_configured, actual_budget_url, last_attempt_at,
                 last_error, pending_refresh_at, refresh_started_at, updated_at)
              VALUES (?, 'unconfigured', 0, NULL, ?, NULL, NULL, NULL, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                status = excluded.status,
                actual_configured = excluded.actual_configured,
                actual_budget_url = excluded.actual_budget_url,
                last_attempt_at = excluded.last_attempt_at,
                last_error = NULL,
                pending_refresh_at = NULL,
                refresh_started_at = NULL,
                updated_at = excluded.updated_at`,
        args: [userId, timestamp, timestamp],
      },
    ]);
    return currentPayloadFromOccurrences([], {
      actualConfigured: false,
      actualBudgetUrl: null,
      now,
      syncHealth: {
        state: "unconfigured",
        configured: false,
        lastSuccessAt: null,
        lastAttemptAt: timestamp,
        lastError: null,
        pendingRefreshAt: null,
        refreshStartedAt: null,
      },
    });
  }

  try {
    const data = await actualGetCalendarBillsRange(userId, BILL_MIRROR_REFRESH_RANGE);
    const occurrences = (data.schedules || [])
      .map(normalizeMirrorOccurrence)
      .filter((occurrence) => occurrence.scheduleId && occurrence.next_date && occurrence.type !== "income");
    const queries = [
      {
        sql: `INSERT INTO ea_bills_mirror_state
                (user_id, status, actual_configured, actual_budget_url, last_attempt_at,
                 refresh_started_at, updated_at)
              VALUES (?, 'refreshing', 1, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                status = 'refreshing',
                actual_configured = 1,
                actual_budget_url = excluded.actual_budget_url,
                last_attempt_at = excluded.last_attempt_at,
                refresh_started_at = excluded.refresh_started_at,
                updated_at = excluded.updated_at`,
        args: [userId, actualBudgetUrl, timestamp, timestamp, timestamp],
      },
      {
        sql: `DELETE FROM ea_bill_occurrence_mirror WHERE user_id = ?`,
        args: [userId],
      },
      {
        sql: `DELETE FROM ea_bill_schedule_mirror WHERE user_id = ?`,
        args: [userId],
      },
      ...occurrences.map((occurrence) => ({
        sql: `INSERT INTO ea_bill_schedule_mirror
                (user_id, schedule_id, name, payee, amount, type, next_date, paid, raw_json, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, schedule_id) DO UPDATE SET
                name = excluded.name,
                payee = excluded.payee,
                amount = excluded.amount,
                type = excluded.type,
                next_date = excluded.next_date,
                paid = excluded.paid,
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at`,
        args: scheduleMirrorArgs(userId, occurrence, timestamp),
      })),
      ...occurrences.map((occurrence) => ({
        sql: `INSERT INTO ea_bill_occurrence_mirror
                (user_id, occurrence_id, schedule_id, occurrence_date, name, payee, amount,
                 type, paid, open_action_disabled, raw_json, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: occurrenceMirrorArgs(userId, occurrence, timestamp),
      })),
      {
        sql: `UPDATE ea_bills_mirror_state
              SET status = 'current',
                  actual_configured = 1,
                  actual_budget_url = ?,
                  last_success_at = ?,
                  last_attempt_at = ?,
                  last_error = NULL,
                  pending_refresh_at = NULL,
                  refresh_started_at = NULL,
                  updated_at = ?
              WHERE user_id = ?`,
        args: [actualBudgetUrl, timestamp, timestamp, timestamp, userId],
      },
    ];
    await dbClient.batch(queries);
    return currentPayloadFromOccurrences(occurrences, {
      actualConfigured: true,
      actualBudgetUrl,
      now,
      syncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: timestamp,
        lastAttemptAt: timestamp,
        lastError: null,
        pendingRefreshAt: null,
        refreshStartedAt: null,
      },
    });
  } catch (err) {
    await dbClient.execute({
      sql: `INSERT INTO ea_bills_mirror_state
              (user_id, status, actual_configured, actual_budget_url, last_attempt_at,
               last_error, refresh_started_at, updated_at)
            VALUES (?, 'degraded', 1, ?, ?, ?, NULL, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              status = CASE
                WHEN ea_bills_mirror_state.last_success_at IS NULL THEN 'needs_sync'
                ELSE 'degraded'
              END,
              actual_configured = 1,
              actual_budget_url = excluded.actual_budget_url,
              last_attempt_at = excluded.last_attempt_at,
              last_error = excluded.last_error,
              refresh_started_at = NULL,
              updated_at = excluded.updated_at`,
      args: [userId, actualBudgetUrl, timestamp, String(err?.message || err).slice(0, 500), timestamp],
    });
    throw err;
  }
}

export async function extractBill(userId, { subject, from, body }) {
  const [categories, accounts] = await Promise.all([
    actualGetCategories(userId).catch(() => []),
    actualGetAccounts(userId).catch(() => []),
  ]);

  const catCodeToId = new Map();
  const catList = [];
  if (Array.isArray(categories)) {
    let i = 1;
    for (const group of categories) {
      for (const c of group.categories || []) {
        const code = `c${i++}`;
        catCodeToId.set(code, c.id);
        catList.push(`${code}:${c.name}`);
      }
    }
  }
  const acctCodeToId = new Map();
  const acctList = [];
  if (Array.isArray(accounts)) {
    let i = 1;
    for (const a of accounts) {
      const code = `a${i++}`;
      acctCodeToId.set(code, a.id);
      acctList.push(`${code}:${a.name}`);
    }
  }

  const trimmed = trimBillBody({ subject, from, body });
  const systemPrompt = `Extract bill fields from an email. Return submit_bill with:
- payee, amount (0 if missing), due_date (YYYY-MM-DD)
- type: "transfer" (credit card payment), "bill" (recurring), "expense" (one-off), "income"
- category_code: closest category's code (c1, c2, ...) if confident, else null
- category_name: the category's display name (copied from the list)
- to_account_code: ONLY for type=transfer, code (a1, a2, ...) of the credit card being paid. Match on Visa/MC/Amex or last-4 digits. Null if unsure.${catList.length ? `\n\nCategories: ${catList.join(", ")}` : ""}${acctList.length ? `\n\nAccounts: ${acctList.join(", ")}` : ""}`;

  const { provider: providerId, model } = await loadBillExtractChoice(userId);
  const provider = PROVIDERS[providerId];
  if (!provider) {
    const err = new Error(`Unknown bill-extract provider: ${providerId}`);
    err.status = 400;
    throw err;
  }
  if (!process.env[provider.envVar]) {
    const err = new Error(`Bill extract unavailable: ${provider.envVar} not set`);
    err.status = 503;
    throw err;
  }

  const { fields, usage } = await provider.extract({
    model,
    systemPrompt,
    content: trimmed,
  });

  console.log(
    `[EA] Bill extract: provider=${providerId} model=${model} in=${usage.input_tokens ?? usage.prompt_tokens ?? "?"} out=${usage.output_tokens ?? usage.completion_tokens ?? "?"} trimmed_chars=${trimmed.length}`,
  );

  return {
    payee: fields.payee,
    amount: fields.amount,
    due_date: fields.due_date,
    type: fields.type,
    category_id: fields.category_code ? catCodeToId.get(fields.category_code) || null : null,
    category_name: fields.category_name || null,
    to_account_id: fields.to_account_code ? acctCodeToId.get(fields.to_account_code) || null : null,
    provider: providerId,
    model,
  };
}
