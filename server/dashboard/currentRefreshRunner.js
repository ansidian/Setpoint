import db from "../db/connection.js";
import { loadUserConfig } from "../platform/config-service.js";
import { providerFor } from "./current-providers/index.js";
import { CURRENT_CACHE_KEYS, expiresAtFor, parsePayload } from "./current-sources.js";
import { saveCacheRow, markCacheRowRefreshFailed } from "./currentCacheStore.js";

// Async refresh orchestration lifted from current-service.js: the per-provider
// fetch-timeout race (P1-6), the synchronous row refresh that writes through the
// cache store, the background in-flight dedup map, and the missing-row refresh.
// The single BACKGROUND_REFRESH_IN_FLIGHT map + its two test helpers live here so
// they share one identity (current-service.js re-exports the helpers).

// Per-provider deadline for a single fetchFresh on the cold-cache / force path,
// so /current can never block indefinitely on the slowest external call (P1-6).
// Comfortably above p99 healthy fetch latency; env-overridable for tests/ops.
const PROVIDER_FETCH_TIMEOUT_MS = 4_000;
const BACKGROUND_REFRESH_IN_FLIGHT = new Map();

export function __resetCurrentDashboardRefreshStateForTests() {
  BACKGROUND_REFRESH_IN_FLIGHT.clear();
}

export async function __waitForCurrentDashboardRefreshesForTests() {
  await Promise.allSettled([...BACKGROUND_REFRESH_IN_FLIGHT.values()]);
}

function providerFetchTimeoutMs() {
  const parsed = Number.parseInt(process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PROVIDER_FETCH_TIMEOUT_MS;
}

// Race a provider fetch against a deadline (P1-6). On timeout this rejects, so
// the existing refreshRows catch routes the key through markCacheRowRefreshFailed
// (a usable existing row degrades; a cold/missing row seeds the fallback). The
// abandoned fetch keeps running but its result is discarded; .catch keeps a late
// rejection from surfacing as an unhandled rejection.
function withProviderFetchTimeout(promise, key) {
  promise.catch(() => {});
  let timer = null;
  const timeoutMs = providerFetchTimeoutMs();
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(
        new Error(`Provider ${key} fetch timed out after ${timeoutMs}ms`),
        { code: "PROVIDER_FETCH_TIMEOUT" },
      ));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function refreshRows(userId, rows, refreshKeys, {
  dbClient = db,
  now = new Date(),
  force = false,
  refreshReasons = {},
} = {}) {
  if (!refreshKeys.length) return rows;

  const config = await loadUserConfig(userId);
  const refreshedRows = { ...rows };
  await Promise.all(refreshKeys.map(async (key) => {
    const provider = providerFor(key);
    try {
      // P1-6: bound each provider fetch so the awaited cold-cache/force refresh
      // can never hang /current on a slow or stuck external call (e.g. the Actual
      // worker). On timeout this throws into the catch below, which seeds a
      // degraded/fallback row and lets the background refresh complete it later.
      const payload = await withProviderFetchTimeout(
        provider.fetchFresh(userId, config, { dbClient, now, force }),
        key,
      );
      await saveCacheRow(userId, key, payload, { dbClient, now });
      refreshedRows[key] = {
        user_id: userId,
        cache_key: key,
        payload_json: JSON.stringify(payload),
        fetched_at: now.toISOString(),
        expires_at: expiresAtFor(key, now),
        status: "current",
        error_message: null,
        last_refresh_failed_at: null,
        last_refresh_error: null,
        refresh_failure_count: 0,
      };
      provider.onRefreshed?.(userId, {
        previousRow: rows[key],
        previousPayload: parsePayload(rows[key], null),
      }, payload, { now, refreshReason: refreshReasons[key] || null });
    } catch (err) {
      console.error(`[Dashboard] ${key} refresh failed:`, err.message);
      refreshedRows[key] = await markCacheRowRefreshFailed(userId, key, err, {
        dbClient,
        now,
        existingRow: rows[key],
      });
    }
  }));
  return refreshedRows;
}

function refreshMapKey(userId, cacheKey) {
  return `${userId}:${cacheKey}`;
}

export function scheduleBackgroundCurrentRefresh(userId, rows, refreshKeys, {
  dbClient = db,
  now = new Date(),
  force = false,
  forceKeys = new Set(),
  refreshReasons = {},
} = {}) {
  for (const cacheKey of refreshKeys) {
    const key = refreshMapKey(userId, cacheKey);
    if (BACKGROUND_REFRESH_IN_FLIGHT.has(key)) continue;
    const promise = Promise.resolve()
      .then(() => refreshRows(userId, rows, [cacheKey], {
        dbClient,
        now,
        force: force || forceKeys.has(cacheKey),
        refreshReasons,
      }))
      .catch((err) => console.error("[Dashboard] background current refresh failed:", err.message))
      .finally(() => {
        if (BACKGROUND_REFRESH_IN_FLIGHT.get(key) === promise) {
          BACKGROUND_REFRESH_IN_FLIGHT.delete(key);
        }
      });
    BACKGROUND_REFRESH_IN_FLIGHT.set(key, promise);
  }
}

export async function refreshMissingRows(userId, rows, options) {
  const missingKeys = CURRENT_CACHE_KEYS.filter((key) => !rows[key]);
  return refreshRows(userId, rows, missingKeys, options);
}
