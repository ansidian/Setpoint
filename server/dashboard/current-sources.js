// Row-level helpers for ea_current_data_cache, derived from the provider
// registry in current-providers/. Payload shapes, TTLs, and fallbacks live on
// the providers; this module owns the generic row/health semantics.
import { createHash } from "crypto";
import { CURRENT_DATA_PROVIDERS, providerFor } from "./current-providers/index.js";

export { EMPTY_DEADLINES } from "./current-providers/deadlines-provider.js";

const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
const REFRESH_FAILURE_GRACE_MS = 15 * 60 * 1000;

export const CURRENT_CACHE_KEYS = CURRENT_DATA_PROVIDERS.map((provider) => provider.key);

export function parsePayload(row, fallback) {
  if (!row?.payload_json) return fallback;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return fallback;
  }
}

export function fallbackPayloadForKey(key) {
  return providerFor(key)?.fallbackPayload() ?? null;
}

export function expiresAtFor(cacheKey, now) {
  const ttlMs = providerFor(cacheKey)?.cacheTtlMs || 5 * 60 * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function isRefreshTimedOut(row, now) {
  if (row?.status !== "refreshing" || !row.refresh_started_at) return false;
  return now.getTime() - new Date(row.refresh_started_at).getTime() > REFRESH_TIMEOUT_MS;
}

export function hasUsablePayload(key, row) {
  const payload = parsePayload(row, undefined);
  if (payload == null) return false;
  const provider = providerFor(key);
  return provider ? provider.hasUsablePayload(payload) : true;
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

// Content fingerprint of a /current response, used by the client to skip a
// re-render when a poll/SSE refetch returns the same rendered data. The response
// carries three fields that change on EVERY call regardless of whether anything
// the user sees changed, so they are neutralized before hashing:
//   - fetchedAt: wall-clock stamp set per response (current-service composes it)
//   - systemStatus.generatedAt: set from fetchedAt
//   - providerHealth.todoist.ageMs: now - lastSuccessAt (todoist-mirror health)
// Everything else participates, so any real data/health-state change still
// produces a new key (bias toward over-rendering, never suppress a real change).
// If a future field leaks wall-clock noise into the response, the
// "stable when only the per-call wall-clock fields differ" test will fail —
// neutralize it here too.
export function currentResponseContentKey(response) {
  if (!response || typeof response !== "object") return null;
  const canonical = { ...response, fetchedAt: null };
  delete canonical.contentKey;
  if (canonical.systemStatus) {
    canonical.systemStatus = { ...canonical.systemStatus, generatedAt: null };
  }
  if (canonical.providerHealth?.todoist) {
    canonical.providerHealth = {
      ...canonical.providerHealth,
      todoist: { ...canonical.providerHealth.todoist, ageMs: null },
    };
  }
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex");
}

export function shouldPublishBillsCurrentChange(previousRow, nextPayload) {
  return providerFor("bills_current").shouldPublishChange(
    previousRow,
    parsePayload(previousRow, null),
    nextPayload,
  );
}
