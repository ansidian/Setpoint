import db from "../db/connection.js";
import { buildBillOccurrencesFromSchedules } from "../actual/actual-bill-occurrences.js";
import {
  hasActualMetadataRows,
  loadActualMetadataForProjection,
  metadataWithPayeeMap,
  upsertMetadataProjectionQuery,
} from "../actual/actual-metadata-projection.js";

const BILL_MIRROR_LOOKBACK_DAYS = 30;
const BILL_MIRROR_LOOKAHEAD_MONTHS = 18;
// How far back cleared (paid) occurrences are retained after their schedule rolls
// forward, so the calendar bill view keeps paid history instead of dropping it.
// Bounded to the displayable window: the bills range route rejects months older
// than 12 months (see validateCalendarRange enforceHistoryWindow), so retaining
// anything older would be dead weight.
const BILL_MIRROR_PAID_HISTORY_MONTHS = 12;
const BILLS_CURRENT_LOOKBACK_DAYS = 30;
const BILLS_CURRENT_LOOKAHEAD_DAYS = 90;
export const BILLS_MIRROR_MAINTENANCE_TTL_MS = 6 * 60 * 60 * 1000;
const BILLS_MIRROR_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const BILLS_MIRROR_REFRESH_TIMERS = new Map();
const BILLS_MIRROR_REFRESH_IN_FLIGHT = new Map();
let billsMirrorRefreshWorkerTimer = null;

function isoNow(now = new Date()) {
  return now.toISOString();
}

function todayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsYmd(ymd, months) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function billMirrorRefreshRange({ now = new Date() } = {}) {
  const today = todayYmd(now);
  return {
    start: addDaysYmd(today, -BILL_MIRROR_LOOKBACK_DAYS),
    end: addMonthsYmd(today, BILL_MIRROR_LOOKAHEAD_MONTHS),
  };
}

function boolFromDb(value) {
  return value === true || value === 1 || value === "1";
}

function occurrencesFromMetadata(metadata, range) {
  const normalized = metadataWithPayeeMap(metadata);
  return buildBillOccurrencesFromSchedules(normalized.schedules, {
    payeeMap: normalized.payeeMap,
    recentTransactions: normalized.recentTransactions,
    range,
  });
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

export function isBillsMirrorMaintenanceDue(syncHealth, { now = new Date() } = {}) {
  if (!syncHealth) return false;
  if (syncHealth.configured !== true) return false;
  if (syncHealth.pendingRefreshAt || syncHealth.refreshStartedAt) return false;
  if (syncHealth.state !== "current" && syncHealth.state !== "degraded") return false;
  if (syncHealth.state === "degraded") {
    const lastAttempt = new Date(syncHealth.lastAttemptAt || "").getTime();
    if (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < BILLS_MIRROR_FAILURE_BACKOFF_MS) {
      return false;
    }
  }
  const lastSuccess = new Date(syncHealth.lastSuccessAt || "").getTime();
  if (!Number.isFinite(lastSuccess)) return false;
  return now.getTime() - lastSuccess >= BILLS_MIRROR_MAINTENANCE_TTL_MS;
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
  const today = todayYmd(now);
  const weekFromNow = addDaysYmd(today, 7);
  const lookbackStart = addDaysYmd(today, -BILLS_CURRENT_LOOKBACK_DAYS);
  const lookaheadEnd = addDaysYmd(today, BILLS_CURRENT_LOOKAHEAD_DAYS);
  const bills = occurrences.filter((occurrence) =>
    occurrence.next_date >= today && occurrence.next_date <= weekFromNow,
  );
  const allSchedules = occurrences.filter((occurrence) =>
    occurrence.next_date >= lookbackStart && occurrence.next_date <= lookaheadEnd,
  );
  return {
    bills,
    allSchedules,
    payeeMap: {},
    actualConfigured,
    actualBudgetUrl,
    syncHealth,
    billsSyncHealth: syncHealth,
  };
}

export async function loadActualBudgetUrl(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: "SELECT actual_budget_url FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  return result.rows?.[0]?.actual_budget_url || null;
}

// P3-38: cheap existence check for the empty-read guard — does the user's bills
// mirror already hold any occurrence rows? Used to decide whether a transient empty
// metadata read should preserve the prior mirror instead of wiping it.
async function priorMirrorHasRows(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM ea_bill_occurrence_mirror WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  return Boolean(result.rows?.length);
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
  const today = todayYmd(now);
  const weekFromNow = addDaysYmd(today, 7);
  const lookbackStart = addDaysYmd(today, -BILLS_CURRENT_LOOKBACK_DAYS);
  const lookaheadEnd = addDaysYmd(today, BILLS_CURRENT_LOOKAHEAD_DAYS);
  const data = await readBillsMirrorRange(userId, { start: lookbackStart, end: lookaheadEnd }, { dbClient });
  const bills = data.schedules.filter((schedule) =>
    schedule.next_date >= today && schedule.next_date <= weekFromNow,
  );
  return {
    bills,
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
  // P3-37: read the existing pending_refresh_at before the upsert so we can arm the
  // in-process timer to the value the DB actually keeps (the earlier of any
  // already-pending time and dueAt), not unconditionally to dueAt.
  const existing = await dbClient.execute({
    sql: `SELECT pending_refresh_at FROM ea_bills_mirror_state WHERE user_id = ?`,
    args: [userId],
  });
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
  // P3-37: mirror the DB's earlier-wins rule in JS so a sooner already-armed refresh
  // is not pushed back to the new (later) dueAt.
  const existingPending = existing.rows?.[0]?.pending_refresh_at || null;
  const persistedDueAt = existingPending && existingPending < dueAt ? existingPending : dueAt;
  if (dbClient === db) armBillsMirrorTimer(userId, persistedDueAt);
  return { pendingRefreshAt: persistedDueAt };
}

export async function consumeDueBillsMirrorRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const dueAt = isoNow(now);
  // P3-39: claim the due refresh atomically. A SELECT-then-UPDATE let two
  // concurrent callers both observe a pending refresh and dispatch it twice.
  // A single conditional UPDATE gated on rowsAffected makes the claim a
  // compare-and-clear: only the writer that actually nulled pending_refresh_at
  // wins; everyone else sees rowsAffected === 0 and bails.
  const result = await dbClient.execute({
    sql: `UPDATE ea_bills_mirror_state
          SET pending_refresh_at = NULL,
              updated_at = ?
          WHERE user_id = ?
            AND pending_refresh_at IS NOT NULL
            AND pending_refresh_at <= ?`,
    args: [dueAt, userId, dueAt],
  });
  if (Number(result.rowsAffected || 0) === 0) return false;
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
  const payload = await refreshBillsMirror(userId, {
    actualBudgetUrl,
    dbClient,
    now,
    refreshLocalActual: true,
  });
  return { refreshed: true, payload };
}

export function __resetBillsMirrorRefreshTimersForTests() {
  for (const timer of BILLS_MIRROR_REFRESH_TIMERS.values()) clearTimeout(timer);
  BILLS_MIRROR_REFRESH_TIMERS.clear();
  BILLS_MIRROR_REFRESH_IN_FLIGHT.clear();
  if (billsMirrorRefreshWorkerTimer) clearInterval(billsMirrorRefreshWorkerTimer);
  billsMirrorRefreshWorkerTimer = null;
}

export async function armPendingBillsMirrorRefreshes({
  dbClient = db,
  now = new Date(),
} = {}) {
  const result = await dbClient.execute({
    // P3-12: constrain the 5-minute scan to the configured single user
    // (EA_USER_ID is load-bearing; this matches the per-user pattern every other
    // ea_bills_mirror_state query already uses) instead of scanning the table.
    sql: `SELECT user_id, pending_refresh_at
          FROM ea_bills_mirror_state
          WHERE user_id = ? AND pending_refresh_at IS NOT NULL`,
    args: [process.env.EA_USER_ID],
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
  refreshLocalActual = false,
} = {}) {
  const inFlightKey = `${userId}:${actualBudgetUrl || "unconfigured"}`;
  const existingRefresh = BILLS_MIRROR_REFRESH_IN_FLIGHT.get(inFlightKey);
  if (existingRefresh) return existingRefresh;
  const refreshPromise = refreshBillsMirrorInner(userId, {
    actualBudgetUrl,
    dbClient,
    now,
    refreshLocalActual,
  })
    .finally(() => {
      if (BILLS_MIRROR_REFRESH_IN_FLIGHT.get(inFlightKey) === refreshPromise) {
        BILLS_MIRROR_REFRESH_IN_FLIGHT.delete(inFlightKey);
      }
    });
  BILLS_MIRROR_REFRESH_IN_FLIGHT.set(inFlightKey, refreshPromise);
  return refreshPromise;
}

async function refreshBillsMirrorInner(userId, {
  actualBudgetUrl = null,
  dbClient = db,
  now = new Date(),
  refreshLocalActual = false,
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
        sql: `DELETE FROM ea_actual_metadata_mirror WHERE user_id = ?`,
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
    const refreshRange = billMirrorRefreshRange({ now });
    const metadata = metadataWithPayeeMap(await loadActualMetadataForProjection(userId, {
      allowWorkerFallback: false,
      preferFreshLocal: refreshLocalActual,
    }));
    // P3-38: a transient empty-but-successful local Actual read (no accounts/payees/
    // categories/schedules) must NOT wipe a populated mirror and commit an empty
    // 'current' state. If the metadata read came back empty yet the mirror already
    // holds occurrence rows, treat it as a degraded read: skip the destructive
    // DELETE/replace, keep the prior rows, and route through the catch block which
    // already writes 'degraded' (without deleting) and returns the prior mirror.
    if (!hasActualMetadataRows(metadata) && await priorMirrorHasRows(userId, { dbClient })) {
      throw Object.assign(
        new Error("Actual metadata read returned empty; preserving prior bills mirror"),
        { code: "BILLS_MIRROR_EMPTY_READ_GUARD" },
      );
    }
    const occurrences = occurrencesFromMetadata(metadata, refreshRange)
      .map(normalizeMirrorOccurrence)
      .filter((occurrence) => occurrence.scheduleId && occurrence.next_date && occurrence.type !== "income");
    // P2-22: instead of deleting and re-inserting the whole 18-month set every
    // refresh, upsert the fresh rows and prune only what is no longer present.
    const freshScheduleIds = [...new Set(occurrences.map((occurrence) => occurrence.scheduleId))];
    const freshOccurrenceIds = [...new Set(occurrences.map((occurrence) => occurrence.id))];
    const pruneQuery = (table, idColumn, ids) => (ids.length
      ? {
          sql: `DELETE FROM ${table} WHERE user_id = ? AND ${idColumn} NOT IN (${ids.map(() => "?").join(",")})`,
          args: [userId, ...ids],
        }
      : { sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] });
    // Occurrences get a history-aware prune: a paid bill whose schedule has rolled
    // forward is no longer in the fresh set, but we keep its now-past occurrence so
    // the calendar bill view retains cleared history. Spare rows that are paid and
    // dated in the recent past (within the retention window); still prune unpaid
    // orphans and paid history older than the window so the table stays bounded.
    const today = todayYmd(now);
    const paidHistoryStart = addMonthsYmd(today, -BILL_MIRROR_PAID_HISTORY_MONTHS);
    const retainPaidHistory = "NOT (paid = 1 AND occurrence_date < ? AND occurrence_date >= ?)";
    const pruneOccurrencesQuery = (ids) => (ids.length
      ? {
          sql: `DELETE FROM ea_bill_occurrence_mirror
                WHERE user_id = ?
                  AND occurrence_id NOT IN (${ids.map(() => "?").join(",")})
                  AND ${retainPaidHistory}`,
          args: [userId, ...ids, today, paidHistoryStart],
        }
      : {
          sql: `DELETE FROM ea_bill_occurrence_mirror WHERE user_id = ? AND ${retainPaidHistory}`,
          args: [userId, today, paidHistoryStart],
        });
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
      upsertMetadataProjectionQuery(userId, metadata, timestamp),
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
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, occurrence_id) DO UPDATE SET
                schedule_id = excluded.schedule_id,
                occurrence_date = excluded.occurrence_date,
                name = excluded.name,
                payee = excluded.payee,
                amount = excluded.amount,
                type = excluded.type,
                paid = excluded.paid,
                open_action_disabled = excluded.open_action_disabled,
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at`,
        args: occurrenceMirrorArgs(userId, occurrence, timestamp),
      })),
      // Prune rows no longer in the fresh set (replaces the unconditional
      // delete-all above). Empty fresh set -> delete all this user's rows.
      pruneQuery("ea_bill_schedule_mirror", "schedule_id", freshScheduleIds),
      pruneOccurrencesQuery(freshOccurrenceIds),
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
    const fallbackRange = billMirrorRefreshRange({ now });
    const fallback = await readBillsMirrorRange(userId, fallbackRange, { dbClient });
    return currentPayloadFromOccurrences(fallback.schedules, {
      actualConfigured: true,
      actualBudgetUrl: fallback.actualBudgetUrl || actualBudgetUrl,
      now,
      syncHealth: fallback.syncHealth,
    });
  }
}
