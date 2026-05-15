export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
};

const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
const REFRESH_FAILURE_GRACE_MS = 15 * 60 * 1000;

const EMPTY_BILLS_CURRENT = {
  bills: [],
  allSchedules: [],
  payeeMap: {},
  actualConfigured: false,
  actualBudgetUrl: null,
};

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function billsHealthProjection(health = null) {
  return {
    state: health?.state || null,
    configured: health?.configured ?? null,
    lastError: health?.lastError || null,
    pendingRefreshAt: health?.pendingRefreshAt || null,
    refreshStartedAt: health?.refreshStartedAt || null,
  };
}

function billsVisibleProjection(payload = null) {
  return {
    bills: payload?.bills || [],
    allSchedules: payload?.allSchedules || [],
    payeeMap: payload?.payeeMap || {},
    actualConfigured: !!payload?.actualConfigured,
    actualBudgetUrl: payload?.actualBudgetUrl || null,
    billsSyncHealth: billsHealthProjection(payload?.billsSyncHealth || payload?.syncHealth || null),
  };
}

const CURRENT_SOURCE_DEFINITIONS = {
  weather_current: {
    ttlMs: 30 * 60 * 1000,
    fallback: () => null,
    hasUsablePayload: (payload) => Boolean(payload?.temp != null || payload?.summary),
  },
  calendar_current: {
    ttlMs: 5 * 60 * 1000,
    fallback: () => [],
    hasUsablePayload: (payload) => Array.isArray(payload),
  },
  deadlines_current: {
    ttlMs: 15 * 60 * 1000,
    fallback: () => clone(EMPTY_DEADLINES),
    hasUsablePayload: (payload) => Array.isArray(payload?.upcoming),
  },
  bills_current: {
    ttlMs: 60 * 60 * 1000,
    fallback: () => clone(EMPTY_BILLS_CURRENT),
    hasUsablePayload: (payload) => Boolean(
      Array.isArray(payload?.bills)
        && Array.isArray(payload?.allSchedules)
        && payload?.payeeMap,
    ),
    visibleProjection: billsVisibleProjection,
  },
};

export const CURRENT_CACHE_KEYS = Object.keys(CURRENT_SOURCE_DEFINITIONS);

function sourceDefinitionFor(key) {
  return CURRENT_SOURCE_DEFINITIONS[key] || null;
}

export function parsePayload(row, fallback) {
  if (!row?.payload_json) return fallback;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return fallback;
  }
}

export function fallbackPayloadForKey(key) {
  return sourceDefinitionFor(key)?.fallback() ?? null;
}

export function expiresAtFor(cacheKey, now) {
  const ttlMs = sourceDefinitionFor(cacheKey)?.ttlMs || 5 * 60 * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function isRefreshTimedOut(row, now) {
  if (row?.status !== "refreshing" || !row.refresh_started_at) return false;
  return now.getTime() - new Date(row.refresh_started_at).getTime() > REFRESH_TIMEOUT_MS;
}

export function hasUsablePayload(key, row) {
  const payload = parsePayload(row, undefined);
  if (payload == null) return false;
  const definition = sourceDefinitionFor(key);
  return definition ? definition.hasUsablePayload(payload) : true;
}

function refreshFailureAgeMs(row, now) {
  if (!row?.last_refresh_failed_at) return null;
  return Math.max(0, now.getTime() - new Date(row.last_refresh_failed_at).getTime());
}

export function sourceHealthForRow(key, row, now) {
  if (!row) return { state: "unavailable", severity: "error" };
  const usable = hasUsablePayload(key, row);
  if (isRefreshTimedOut(row, now)) {
    return usable ? { state: "degraded", severity: "warning" } : { state: "unavailable", severity: "error" };
  }
  if (row.status === "refreshing" || row.refresh_started_at) {
    return usable ? { state: "refreshing", severity: "info" } : { state: "unavailable", severity: "error" };
  }
  if (row.status === "unavailable") {
    return usable ? { state: "degraded", severity: "none" } : { state: "unavailable", severity: "error" };
  }
  if (row.status === "degraded") {
    const ageMs = refreshFailureAgeMs(row, now);
    return {
      state: "degraded",
      severity: ageMs != null && ageMs < REFRESH_FAILURE_GRACE_MS ? "none" : "warning",
    };
  }
  if (!usable) return { state: "unavailable", severity: "error" };
  return { state: "current", severity: "none" };
}

function maxIso(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function summarizeCurrentDataHealth(rows, now) {
  const sourceRows = CURRENT_CACHE_KEYS.map((key) => rows[key]).filter(Boolean);
  const sources = CURRENT_CACHE_KEYS.map((key) => {
    const row = rows[key];
    const health = sourceHealthForRow(key, row, now);
    return {
      key,
      state: health.state,
      severity: health.severity,
      fetchedAt: row?.fetched_at || null,
      expiresAt: row?.expires_at || null,
      errorMessage: row?.last_refresh_error || row?.error_message || null,
      failedAt: row?.last_refresh_failed_at || null,
      failureCount: Number(row?.refresh_failure_count || 0),
      refreshStartedAt: row?.refresh_started_at || null,
    };
  });
  const severities = sources.map((source) => source.severity);
  const state = severities.includes("error")
    ? "unavailable"
    : severities.includes("warning")
      ? "degraded"
      : "current";

  return {
    state,
    lastSuccessAt: maxIso(sourceRows.map((row) => row.fetched_at)),
    sources,
  };
}

export function shouldPublishBillsCurrentChange(previousRow, nextPayload) {
  const previousPayload = parsePayload(previousRow, null);
  if (!previousPayload) return true;
  if (previousRow?.status && previousRow.status !== "current") return true;
  if (Number(previousRow?.refresh_failure_count || 0) > 0) return true;
  return JSON.stringify(billsVisibleProjection(previousPayload)) !== JSON.stringify(billsVisibleProjection(nextPayload));
}
