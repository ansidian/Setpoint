// Pure derivation for the bills mirror: date/range math, row<->object projections,
// the mirror upsert arg builders, the maintenance-due predicate, and the current/range
// payload shaping. DB-free — the residual (bills-mirror-sync.ts) owns all IO, the
// scheduler singletons, and the refresh orchestration.
import { buildBillOccurrencesFromSchedules } from "../actual/actual-bill-occurrences.ts";
import { metadataWithPayeeMap } from "../actual/actual-metadata-projection.ts";
import type { InArgs } from "@libsql/client";
import type { ActualBillOccurrence, ActualDateRange, ActualMetadata } from "../../shared/types/actual.ts";
import type { BillsMirrorHealth, BillsMirrorPayload } from "../../shared/types/bills.ts";

const BILL_MIRROR_LOOKBACK_DAYS = 30;
const BILL_MIRROR_LOOKAHEAD_MONTHS = 18;
// Exported so the residual's readBillsMirrorCurrent reuses the same current-window
// bounds without redeclaring them (both compute the same lookback/lookahead).
export const BILLS_CURRENT_LOOKBACK_DAYS = 30;
export const BILLS_CURRENT_LOOKAHEAD_DAYS = 90;
export const BILLS_MIRROR_MAINTENANCE_TTL_MS = 6 * 60 * 60 * 1000;
const BILLS_MIRROR_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

export function todayYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsYmd(ymd: string, months: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function billMirrorRefreshRange({ now = new Date() }: { now?: Date } = {}): ActualDateRange {
  const today = todayYmd(now);
  return {
    start: addDaysYmd(today, -BILL_MIRROR_LOOKBACK_DAYS),
    end: addMonthsYmd(today, BILL_MIRROR_LOOKAHEAD_MONTHS),
  };
}

function boolFromDb(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function occurrencesFromMetadata(metadata: Partial<ActualMetadata>, range: ActualDateRange): ActualBillOccurrence[] {
  const normalized = metadataWithPayeeMap(metadata);
  return buildBillOccurrencesFromSchedules(normalized.schedules, {
    payeeMap: normalized.payeeMap,
    recentTransactions: normalized.recentTransactions,
    range,
  });
}

export function mirrorStateFromRow(row: Record<string, unknown> | null | undefined): BillsMirrorHealth {
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
    state: String(row.status || "needs_sync"),
    configured: boolFromDb(row.actual_configured),
    lastSuccessAt: row.last_success_at == null ? null : String(row.last_success_at),
    lastAttemptAt: row.last_attempt_at == null ? null : String(row.last_attempt_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    pendingRefreshAt: row.pending_refresh_at == null ? null : String(row.pending_refresh_at),
    refreshStartedAt: row.refresh_started_at == null ? null : String(row.refresh_started_at),
  };
}

export function isBillsMirrorMaintenanceDue(syncHealth: BillsMirrorHealth | null | undefined, { now = new Date() }: { now?: Date } = {}): boolean {
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

export function occurrenceFromRow(row: Record<string, unknown>): ActualBillOccurrence {
  return {
    id: String(row.occurrence_id),
    scheduleId: String(row.schedule_id),
    name: String(row.name || row.payee || "Unknown"),
    payee: String(row.payee || row.name || "Unknown"),
    amount: Number(row.amount || 0),
    next_date: String(row.occurrence_date),
    paid: boolFromDb(row.paid),
    type: row.type === "income" || row.type === "transfer" ? row.type : "bill",
    openActionDisabled: boolFromDb(row.open_action_disabled),
  };
}

export function normalizeMirrorOccurrence(schedule: Partial<ActualBillOccurrence> & { schedule_id?: string; occurrence_date?: string }): ActualBillOccurrence {
  const scheduleId = schedule.scheduleId || schedule.schedule_id || schedule.id;
  const date = schedule.next_date || schedule.occurrence_date;
  const occurrenceId = schedule.id && String(schedule.id).includes(":")
    ? String(schedule.id)
    : `${scheduleId}:${date}`;
  return {
    id: occurrenceId,
    scheduleId: String(scheduleId),
    name: schedule.name || schedule.payee || "Unknown",
    payee: schedule.payee || schedule.name || "Unknown",
    amount: Number(schedule.amount || 0),
    next_date: String(date),
    paid: !!schedule.paid,
    type: schedule.type || "bill",
    openActionDisabled: !!schedule.openActionDisabled,
  };
}

export function scheduleMirrorArgs(userId: string, occurrence: ActualBillOccurrence, timestamp: string): InArgs {
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

export function occurrenceMirrorArgs(userId: string, occurrence: ActualBillOccurrence, timestamp: string): InArgs {
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

export function currentPayloadFromOccurrences(occurrences: ActualBillOccurrence[], {
  actualBudgetUrl = null,
  actualConfigured = false,
  syncHealth,
  now = new Date(),
}: {
  actualBudgetUrl?: string | null;
  actualConfigured?: boolean;
  syncHealth: BillsMirrorHealth;
  now?: Date;
}): BillsMirrorPayload {
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
