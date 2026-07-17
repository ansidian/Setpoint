const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEGRADED_AFTER_MS = 24 * 60 * 60 * 1000;
import type {
  CalendarMirrorHealth,
  CalendarMirrorHealthSeverity,
  CalendarMirrorHealthState,
  CalendarMirrorSourceHealth,
} from "../../shared/types/calendar.ts";

export interface CalendarMirrorStateRow {
  account_id: string;
  calendar_id: string;
  account_label?: string | null;
  account_email?: string | null;
  calendar_label?: string | null;
  source_color?: string | null;
  window_start: string;
  window_end: string;
  status?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  sync_started_at?: string | null;
  sync_requested_at?: string | null;
  sync_request_reason?: string | null;
  dirty_since?: string | null;
  dirty_reason?: string | null;
  last_check_failed_at?: string | null;
  failed_check_count?: number | null;
}

function isAfter(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function ageMs(value: string | null | undefined, now: Date) {
  if (!value) return null;
  return Math.max(0, now.getTime() - new Date(value).getTime());
}

function sourceHealth(row: CalendarMirrorStateRow, now: Date): CalendarMirrorSourceHealth {
  const lastSuccessAt = row.last_success_at || null;
  const successAgeMs = ageMs(lastSuccessAt, now);
  const pendingSync = isAfter(row.sync_requested_at, lastSuccessAt);
  const dirty = isAfter(row.dirty_since, lastSuccessAt);
  const failedAgeMs = ageMs(row.last_check_failed_at || lastSuccessAt, now);
  const failedCheckCount = Number(row.failed_check_count || 0);

  let state: CalendarMirrorHealthState = "current";
  let severity: CalendarMirrorHealthSeverity = "none";
  if (row.status === "syncing") {
    state = "syncing";
    severity = "info";
  } else if (!lastSuccessAt) {
    state = "initializing";
    severity = "info";
  } else if (dirty || pendingSync) {
    state = "dirty";
    severity = "warning";
  } else if (failedCheckCount > 0 && failedAgeMs != null && failedAgeMs >= DEGRADED_AFTER_MS) {
    state = "degraded";
    severity = "warning";
  } else if (successAgeMs != null && successAgeMs >= STALE_AFTER_MS) {
    state = "stale";
    severity = "warning";
  }

  return {
    accountId: row.account_id,
    calendarId: row.calendar_id,
    accountLabel: row.account_label || null,
    accountEmail: row.account_email || null,
    calendarLabel: row.calendar_label || row.calendar_id,
    sourceColor: row.source_color || null,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    state,
    severity,
    lastSuccessAt,
    lastError: row.last_error || null,
    syncStartedAt: row.sync_started_at || null,
    syncRequestedAt: row.sync_requested_at || null,
    syncRequestReason: row.sync_request_reason || null,
    dirtySince: row.dirty_since || null,
    dirtyReason: row.dirty_reason || null,
    lastCheckFailedAt: row.last_check_failed_at || null,
    failedCheckCount,
    ageMs: successAgeMs,
  };
}

function aggregateHealth(sources: CalendarMirrorSourceHealth[]): {
  state: CalendarMirrorHealthState;
  severity: CalendarMirrorHealthSeverity;
} {
  if (!sources.length) return { state: "initializing", severity: "info" };
  if (sources.some((source) => source.state === "degraded")) return { state: "degraded", severity: "warning" };
  if (sources.some((source) => source.state === "dirty")) return { state: "dirty", severity: "warning" };
  if (sources.some((source) => source.state === "stale")) return { state: "stale", severity: "warning" };
  if (sources.some((source) => source.state === "initializing")) return { state: "initializing", severity: "info" };
  if (sources.some((source) => source.state === "syncing")) return { state: "syncing", severity: "info" };
  return { state: "current", severity: "none" };
}

// Pure derivation of the calendar-search-mirror health shape from the
// ea_calendar_search_mirror_state rows (one per account+calendar source).
export function computeCalendarSearchMirrorHealth(
  rows: CalendarMirrorStateRow[],
  { now = new Date() }: { now?: Date } = {},
): CalendarMirrorHealth {
  const sources = rows.map((row) => sourceHealth(row, now));
  const aggregate = aggregateHealth(sources);
  return {
    state: aggregate.state,
    configured: true,
    severity: aggregate.severity,
    sources,
  };
}
