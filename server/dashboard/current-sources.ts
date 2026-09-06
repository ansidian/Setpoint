// Row-level helpers for ea_current_data_cache, derived from the provider
// registry in current-providers/. Payload shapes, TTLs, and fallbacks live on
// the providers; this module owns the generic row/health semantics.
import { createHash } from "crypto";
import { CURRENT_DATA_PROVIDERS, providerFor } from "./current-providers/index.ts";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardCacheRow,
  CurrentDashboardCacheRows,
  CurrentDashboardDataHealth,
  CurrentDashboardHealthState,
} from "../../shared/types/dashboard.ts";

export { EMPTY_DEADLINES } from "./current-providers/deadlines-provider.ts";

const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;

export const CURRENT_CACHE_KEYS: CurrentDashboardCacheKey[] = CURRENT_DATA_PROVIDERS.map((provider) => provider.key);

export function parsePayload<T = undefined>(
  row: CurrentDashboardCacheRow | null | undefined,
  fallback?: T,
): unknown | T | undefined {
  if (!row?.payload_json) return fallback;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return fallback;
  }
}

export function fallbackPayloadForKey(key: CurrentDashboardCacheKey): unknown {
  return providerFor(key)?.fallbackPayload() ?? null;
}

export function expiresAtFor(cacheKey: CurrentDashboardCacheKey, now: Date): string {
  const ttlMs = providerFor(cacheKey)?.cacheTtlMs || 5 * 60 * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function isRefreshTimedOut(row: CurrentDashboardCacheRow | null | undefined, now: Date): boolean {
  if (row?.status !== "refreshing" || !row.refresh_started_at) return false;
  return now.getTime() - new Date(row.refresh_started_at).getTime() > REFRESH_TIMEOUT_MS;
}

export function hasUsablePayload(key: CurrentDashboardCacheKey, row: CurrentDashboardCacheRow | null | undefined): boolean {
  // Unavailable rows contain generated fallbacks, not a successful provider read.
  // Null fetched_at also survives the retry transition from a cold failure.
  if (row?.status === "unavailable" || row?.fetched_at === null) return false;
  const payload = parsePayload(row, undefined);
  if (payload == null) return false;
  const provider = providerFor(key);
  return provider ? provider.hasUsablePayload(payload) : true;
}

export function sourceHealthForRow(
  key: CurrentDashboardCacheKey,
  row: CurrentDashboardCacheRow | undefined,
  now: Date,
): { state: CurrentDashboardHealthState; severity: "none" | "info" | "warning" | "error" } {
  if (!row) return { state: "unavailable", severity: "error" };
  const usable = hasUsablePayload(key, row);
  if (isRefreshTimedOut(row, now)) {
    return usable ? { state: "degraded", severity: "warning" } : { state: "unavailable", severity: "error" };
  }
  // A retry does not erase the last failed outcome before it succeeds.
  if (row.status === "degraded" || row.status === "unavailable" || Number(row.refresh_failure_count || 0) > 0) {
    return usable ? { state: "degraded", severity: "warning" } : { state: "unavailable", severity: "error" };
  }
  if (row.status === "refreshing" || row.refresh_started_at) {
    return usable ? { state: "refreshing", severity: "info" } : { state: "unavailable", severity: "error" };
  }
  if (!usable) return { state: "unavailable", severity: "error" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    return { state: "needs_sync", severity: "info" };
  }
  return { state: "current", severity: "none" };
}

function maxIso(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function summarizeCurrentDataHealth(rows: CurrentDashboardCacheRows, now: Date): CurrentDashboardDataHealth {
  const sources = CURRENT_CACHE_KEYS.map((key) => {
    const row = rows[key];
    const health = sourceHealthForRow(key, row, now);
    return {
      key,
      state: health.state,
      severity: health.severity,
      fetchedAt: hasUsablePayload(key, row) ? row?.fetched_at || null : null,
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
    lastSuccessAt: maxIso(sources.map((source) => source.fetchedAt)),
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
export function currentResponseContentKey(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const canonical: Record<string, unknown> = { ...response as Record<string, unknown>, fetchedAt: null };
  delete canonical.contentKey;
  if (canonical.systemStatus && typeof canonical.systemStatus === "object") {
    canonical.systemStatus = { ...canonical.systemStatus as Record<string, unknown>, generatedAt: null };
  }
  const providerHealth = canonical.providerHealth && typeof canonical.providerHealth === "object"
    ? canonical.providerHealth as Record<string, unknown>
    : null;
  if (providerHealth?.todoist && typeof providerHealth.todoist === "object") {
    canonical.providerHealth = {
      ...providerHealth,
      todoist: { ...providerHealth.todoist as Record<string, unknown>, ageMs: null },
    };
  }
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex");
}
