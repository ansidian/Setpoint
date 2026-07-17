// Pure derivation for the bills mirror: date/range math, row<->object projections,
// the mirror upsert arg builders, the maintenance-due predicate, and the current/range
// payload shaping. DB-free — the residual (bills-mirror-sync.js) owns all IO, the
// scheduler singletons, and the refresh orchestration.
import { buildBillOccurrencesFromSchedules } from "../actual/actual-bill-occurrences.ts";
import { metadataWithPayeeMap } from "../actual/actual-metadata-projection.ts";

const BILL_MIRROR_LOOKBACK_DAYS = 30;
const BILL_MIRROR_LOOKAHEAD_MONTHS = 18;
// Exported so the residual's readBillsMirrorCurrent reuses the same current-window
// bounds without redeclaring them (both compute the same lookback/lookahead).
export const BILLS_CURRENT_LOOKBACK_DAYS = 30;
export const BILLS_CURRENT_LOOKAHEAD_DAYS = 90;
export const BILLS_MIRROR_MAINTENANCE_TTL_MS = 6 * 60 * 60 * 1000;
const BILLS_MIRROR_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

export function isoNow(now = new Date()) {
  return now.toISOString();
}

export function todayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsYmd(ymd, months) {
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

export function occurrencesFromMetadata(metadata, range) {
  const normalized = metadataWithPayeeMap(metadata);
  return buildBillOccurrencesFromSchedules(normalized.schedules, {
    payeeMap: normalized.payeeMap,
    recentTransactions: normalized.recentTransactions,
    range,
  });
}

export function mirrorStateFromRow(row) {
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

export function occurrenceFromRow(row) {
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

export function normalizeMirrorOccurrence(schedule) {
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

export function scheduleMirrorArgs(userId, occurrence, timestamp) {
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

export function occurrenceMirrorArgs(userId, occurrence, timestamp) {
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

export function currentPayloadFromOccurrences(occurrences, {
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
