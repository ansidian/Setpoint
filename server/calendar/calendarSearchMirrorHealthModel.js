const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEGRADED_AFTER_MS = 24 * 60 * 60 * 1000;

function isAfter(left, right) {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function ageMs(value, now) {
  if (!value) return null;
  return Math.max(0, now.getTime() - new Date(value).getTime());
}

function sourceHealth(row, now) {
  const lastSuccessAt = row.last_success_at || null;
  const successAgeMs = ageMs(lastSuccessAt, now);
  const pendingSync = isAfter(row.sync_requested_at, lastSuccessAt);
  const dirty = isAfter(row.dirty_since, lastSuccessAt);
  const failedAgeMs = ageMs(row.last_check_failed_at || lastSuccessAt, now);
  const failedCheckCount = Number(row.failed_check_count || 0);

  let state = "current";
  let severity = "none";
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

function aggregateHealth(sources) {
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
export function computeCalendarSearchMirrorHealth(rows, { now = new Date() } = {}) {
  const sources = rows.map((row) => sourceHealth(row, now));
  const aggregate = aggregateHealth(sources);
  return {
    state: aggregate.state,
    configured: true,
    severity: aggregate.severity,
    sources,
  };
}
