// Engine for the /api/dashboard/current envelope. All provider-specific
// behavior (fetching, publish-on-change, backoff, maintenance) lives on the
// provider modules in current-providers/; this file owns cache rows, refresh
// planning/scheduling, and response composition.
import db from "../db/connection.js";
import { getBillsMirrorState } from "../bills/bills-service.js";
import { publishCurrentDashboardEvent } from "./current-events.js";
import { computeDeadlineStats } from "../tasks/deadline-helpers.js";
import { loadUserConfig } from "../platform/config-service.js";
import { getActiveSnapshotView, syncActiveSnapshot } from "../snapshots/snapshot-service.js";
import { getTodoistSyncHealth } from "../tasks/todoist.js";
import {
  hydrateCalendarEventsWithReminderState,
  hydrateTodoistTasksWithReminderState,
} from "../reminders/reminder-hydration.js";
import { CURRENT_DATA_PROVIDERS, providerFor } from "./current-providers/index.js";
import {
  CURRENT_CACHE_KEYS,
  EMPTY_DEADLINES,
  expiresAtFor,
  fallbackPayloadForKey,
  hasUsablePayload,
  isRefreshTimedOut,
  parsePayload,
  sourceHealthForRow,
  summarizeCurrentDataHealth,
} from "./current-sources.js";

const PASSIVE_FAILURE_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const SNAPSHOT_SYNC_TIMEOUT_MS = 2_500;
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

export const __currentDashboardInternalsForTests = {
  markRowsRefreshing,
  markCacheRowRefreshFailed,
};

function isFresh(row, now = new Date()) {
  if (!row?.expires_at) return false;
  return new Date(row.expires_at).getTime() > now.getTime();
}

async function loadCacheRows(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
                 refresh_started_at, last_refresh_failed_at, last_refresh_error, refresh_failure_count
          FROM ea_current_data_cache
          WHERE user_id = ?
            AND cache_key IN (${CURRENT_CACHE_KEYS.map(() => "?").join(",")})`,
    args: [userId, ...CURRENT_CACHE_KEYS],
  });

  return Object.fromEntries(result.rows.map((row) => [row.cache_key, row]));
}

function unavailableTodoistHealth(err) {
  return {
    state: "unavailable",
    configured: null,
    severity: "error",
    lastSuccessAt: null,
    lastError: err?.message || "Todoist sync health unavailable",
    syncStartedAt: null,
    ageMs: null,
  };
}

async function loadProviderHealth(userId, rows, { now = new Date(), todoistHealth = null } = {}) {
  const currentData = summarizeCurrentDataHealth(rows, now);
  const todoist = todoistHealth || await getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err));
  const billsPayload = parsePayload(rows.bills_current, null);
  const bills = billsPayload?.billsSyncHealth || {
    state: billsPayload?.actualConfigured ? "current" : "unconfigured",
    configured: !!billsPayload?.actualConfigured,
    lastSuccessAt: rows.bills_current?.fetched_at || null,
    lastError: null,
  };
  return { currentData, todoist, bills };
}

function currentDataMessage(state) {
  if (state === "current") return "Current dashboard data is usable.";
  if (state === "degraded") return "Some current dashboard data needs attention.";
  return "Some current dashboard data is unavailable.";
}

function todoistMessage(health) {
  if (health?.configured === false || health?.state === "unconfigured") return "Todoist is not configured.";
  if (health.state === "current") return "Todoist mirror is current.";
  if (health.state === "syncing") return "Todoist mirror is syncing.";
  if (health.state === "needs_sync" || health.state === "stale") return "Todoist mirror needs sync.";
  if (health.state === "degraded") return "Todoist mirror checks are degraded.";
  return "Todoist mirror is unavailable.";
}

function billsMessage(health) {
  if (health?.configured === false || health?.state === "unconfigured") return "Bills mirror is not configured.";
  if (health?.state === "current") return "Bills mirror is current.";
  if (health?.state === "refreshing" || health?.state === "syncing") return "Bills mirror is syncing.";
  if (health?.state === "needs_sync" || health?.state === "stale") return "Bills mirror needs sync.";
  if (health?.state === "degraded") return "Bills mirror checks are degraded.";
  return "Bills mirror is unavailable.";
}

function summarizeSystemState(sources) {
  const configuredSources = sources.filter((source) => source.state !== "unconfigured" && source.severity !== "none");
  const severities = configuredSources.map((source) => source.severity);
  if (severities.includes("error")) return "unavailable";
  if (severities.includes("warning") && configuredSources.some((source) => source.state === "needs_sync")) return "needs_sync";
  if (severities.includes("warning")) return "degraded";
  return "current";
}

function composeSystemStatus(providerHealth, { generatedAt = new Date().toISOString() } = {}) {
  const todoistState = providerHealth.todoist?.state || "unavailable";
  const billsState = providerHealth.bills?.state || "unavailable";
  const sources = [
    {
      key: "currentData",
      label: "Current data",
      state: providerHealth.currentData.state,
      severity: providerHealth.currentData.state === "unavailable"
        ? "error"
        : providerHealth.currentData.state === "degraded"
          ? "warning"
          : "none",
      lastSuccessAt: providerHealth.currentData.lastSuccessAt || null,
      message: currentDataMessage(providerHealth.currentData.state),
    },
    {
      key: "todoist",
      label: "Todoist",
      state: todoistState === "stale" ? "needs_sync" : todoistState,
      severity: providerHealth.todoist?.severity || (
        todoistState === "unavailable" ? "error" : todoistState === "syncing" ? "info" : "none"
      ),
      lastSuccessAt: providerHealth.todoist?.lastSuccessAt || null,
      message: todoistMessage(providerHealth.todoist),
    },
    {
      key: "bills",
      label: "Bills",
      state: billsState === "stale" ? "needs_sync" : billsState,
      severity: providerHealth.bills?.severity || (
        billsState === "unavailable" ? "error"
          : billsState === "needs_sync" || billsState === "degraded" || billsState === "stale" ? "warning"
            : billsState === "refreshing" || billsState === "syncing" ? "info"
              : "none"
      ),
      lastSuccessAt: providerHealth.bills?.lastSuccessAt || null,
      message: billsMessage(providerHealth.bills),
    },
  ];

  return {
    state: summarizeSystemState(sources),
    sources,
    generatedAt,
  };
}

export async function applyDeadlineCurrentStatus(userId, taskId, status, {
  dbClient = db,
  now = new Date(),
} = {}) {
  if (!userId || taskId == null || !status) return { updated: false };
  const result = await dbClient.execute({
    sql: `SELECT payload_json
          FROM ea_current_data_cache
          WHERE user_id = ? AND cache_key = 'deadlines_current'`,
    args: [userId],
  });
  const row = result.rows[0];
  if (!row?.payload_json) return { updated: false };

  const payload = parsePayload(row, EMPTY_DEADLINES);
  let updated = false;
  for (const task of payload?.upcoming || []) {
    if (String(task?.id) !== String(taskId)) continue;
    task.status = status;
    delete task._completing;
    updated = true;
  }
  if (updated) {
    payload.stats = computeDeadlineStats(payload.upcoming);
  }
  if (!updated) return { updated: false };

  await dbClient.execute({
    sql: `UPDATE ea_current_data_cache
          SET payload_json = ?,
              status = 'current',
              error_message = NULL,
              refresh_started_at = NULL,
              updated_at = ?
          WHERE user_id = ? AND cache_key = 'deadlines_current'`,
    args: [JSON.stringify(payload), now.toISOString(), userId],
  });
  publishCurrentDashboardEvent(userId, {
    source: "deadlines",
    reason: "task_status_updated",
    state: "current",
    occurredAt: now.toISOString(),
    details: {
      taskId: String(taskId),
      status,
    },
  });
  return { updated: true, payload };
}

function snapshotSyncTimeoutMs() {
  const parsed = Number.parseInt(process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SNAPSHOT_SYNC_TIMEOUT_MS;
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

async function saveCacheRow(userId, cacheKey, payload, {
  dbClient = db,
  now = new Date(),
  status = "current",
  errorMessage = null,
} = {}) {
  const timestamp = now.toISOString();
  await dbClient.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message, refresh_started_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(user_id, cache_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = excluded.status,
            error_message = excluded.error_message,
            refresh_started_at = NULL,
            last_refresh_failed_at = NULL,
            last_refresh_error = NULL,
            refresh_failure_count = 0,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      cacheKey,
      JSON.stringify(payload),
      timestamp,
      expiresAtFor(cacheKey, now),
      status,
      errorMessage,
      timestamp,
    ],
  });
}

async function markCacheRowRefreshFailed(userId, cacheKey, err, {
  dbClient = db,
  now = new Date(),
  existingRow = null,
} = {}) {
  const timestamp = now.toISOString();
  const message = String(err?.message || err || "Current data refresh failed").slice(0, 500);
  const usable = hasUsablePayload(cacheKey, existingRow);
  const payload = usable ? parsePayload(existingRow, fallbackPayloadForKey(cacheKey)) : fallbackPayloadForKey(cacheKey);
  const fetchedAt = usable ? existingRow.fetched_at : timestamp;
  const expiresAt = usable ? existingRow.expires_at : expiresAtFor(cacheKey, now);
  const status = usable ? "degraded" : "unavailable";
  const failureCount = Number(existingRow?.refresh_failure_count || 0) + 1;
  await dbClient.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
             refresh_started_at, last_refresh_failed_at, last_refresh_error,
             refresh_failure_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
          ON CONFLICT(user_id, cache_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = excluded.status,
            error_message = excluded.error_message,
            refresh_started_at = NULL,
            last_refresh_failed_at = excluded.last_refresh_failed_at,
            last_refresh_error = excluded.last_refresh_error,
            refresh_failure_count = COALESCE(ea_current_data_cache.refresh_failure_count, 0) + 1,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      cacheKey,
      JSON.stringify(payload),
      fetchedAt,
      expiresAt,
      status,
      message,
      timestamp,
      message,
      timestamp,
    ],
  });
  return {
    user_id: userId,
    cache_key: cacheKey,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    status,
    error_message: message,
    last_refresh_failed_at: timestamp,
    last_refresh_error: message,
    refresh_failure_count: failureCount,
  };
}

async function refreshRows(userId, rows, refreshKeys, {
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

async function markRowsRefreshing(userId, rows, refreshKeys, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const timestamp = now.toISOString();
  const nextRows = { ...rows };
  if (!refreshKeys.length) return nextRows;
  await dbClient.batch(refreshKeys.map((key) => {
    const currentPayload = rows[key]?.payload_json || JSON.stringify(fallbackPayloadForKey(key));
    const fetchedAt = rows[key]?.fetched_at || null;
    const expiresAt = rows[key]?.expires_at || timestamp;
    // Carry refresh_failure_count / last_refresh_failed_at from rows[key] into the
    // in-memory refreshing row so a subsequent markCacheRowRefreshFailed escalates the
    // returned failureCount instead of resetting to 1 (the persisted COALESCE already escalates).
    nextRows[key] = {
      user_id: userId,
      cache_key: key,
      payload_json: currentPayload,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      status: "refreshing",
      error_message: null,
      refresh_started_at: timestamp,
      last_refresh_failed_at: rows[key]?.last_refresh_failed_at ?? null,
      last_refresh_error: rows[key]?.last_refresh_error ?? null,
      refresh_failure_count: Number(rows[key]?.refresh_failure_count || 0),
    };
    return {
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at,
               status, error_message, refresh_started_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'refreshing', NULL, ?, ?)
            ON CONFLICT(user_id, cache_key) DO UPDATE SET
              status = 'refreshing',
              error_message = NULL,
              refresh_started_at = excluded.refresh_started_at,
              updated_at = excluded.updated_at`,
      args: [userId, key, currentPayload, fetchedAt, expiresAt, timestamp, timestamp],
    };
  }));
  return nextRows;
}

function refreshMapKey(userId, cacheKey) {
  return `${userId}:${cacheKey}`;
}

function scheduleBackgroundCurrentRefresh(userId, rows, refreshKeys, {
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

async function refreshMissingRows(userId, rows, options) {
  const missingKeys = CURRENT_CACHE_KEYS.filter((key) => !rows[key]);
  return refreshRows(userId, rows, missingKeys, options);
}

function skippedEntry(key, reason) {
  return { key, reason };
}

function scheduledEntry(key, reason) {
  return { key, reason };
}

function ensureScheduled(refreshPlan, key, reason) {
  refreshPlan.skipped = refreshPlan.skipped.filter((entry) => entry.key !== key);
  if (!refreshPlan.scheduled.some((entry) => entry.key === key)) {
    refreshPlan.scheduled.push(scheduledEntry(key, reason));
  }
}

function passiveBackoffMs(failureCount) {
  if (failureCount <= 1) return PASSIVE_FAILURE_BACKOFF_MS[0];
  if (failureCount === 2) return PASSIVE_FAILURE_BACKOFF_MS[1];
  return PASSIVE_FAILURE_BACKOFF_MS[2];
}

function isInPassiveBackoff(row, now) {
  const failedAt = row?.last_refresh_failed_at;
  const count = Number(row?.refresh_failure_count || 0);
  if (!failedAt || count <= 0) return false;
  return now.getTime() - new Date(failedAt).getTime() < passiveBackoffMs(count);
}

function refreshReasonForSource(key, row, mode, now) {
  if (!row) return "missing";
  const health = sourceHealthForRow(key, row, now);
  if (!hasUsablePayload(key, row)) return "no_usable_payload";
  if (health.state === "unavailable") return "unavailable";
  if (health.state === "degraded") return mode === "manual" ? "manual_retry" : "degraded";
  if (!isFresh(row, now)) return "ttl_due";
  return null;
}

function planCurrentDataRefresh(rows, {
  mode,
  now,
  force = false,
  context = {},
} = {}) {
  const scheduled = [];
  const skipped = [];
  for (const provider of CURRENT_DATA_PROVIDERS) {
    const key = provider.key;
    const row = rows[key];
    if (force) {
      scheduled.push(scheduledEntry(key, "force"));
      continue;
    }
    if (row?.status === "refreshing" || row?.refresh_started_at) {
      if (isRefreshTimedOut(row, now)) scheduled.push(scheduledEntry(key, "degraded"));
      else skipped.push(skippedEntry(key, "already_refreshing"));
      continue;
    }
    const overrideReason = provider.refreshReasonOverride?.({ row, now, context });
    if (overrideReason) {
      scheduled.push(scheduledEntry(key, overrideReason));
      continue;
    }
    const reason = refreshReasonForSource(key, row, mode, now);
    if (!reason) {
      skipped.push(skippedEntry(key, isFresh(row, now) ? "fresh" : "not_due"));
      continue;
    }
    if (mode === "passive" && isInPassiveBackoff(row, now)) {
      skipped.push(skippedEntry(key, "backoff"));
      continue;
    }
    scheduled.push(scheduledEntry(key, reason));
  }
  return { scheduled, skipped };
}

function applyProviderPassiveSuppression(refreshPlan, rows, { now, context = {} } = {}) {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.passiveSuppressReason) continue;
    const reason = provider.passiveSuppressReason({ row: rows[provider.key], now, context });
    if (!reason) continue;
    const scheduledBefore = refreshPlan.scheduled.length;
    refreshPlan.scheduled = refreshPlan.scheduled.filter((entry) => entry.key !== provider.key);
    if (refreshPlan.scheduled.length !== scheduledBefore) {
      refreshPlan.skipped.push(skippedEntry(provider.key, reason));
    }
  }
}

function applyProviderMaintenanceRefresh(refreshPlan, rows, { forceKeys, now, context = {} } = {}) {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.maintenanceRefreshReason) continue;
    const row = rows[provider.key];
    const reason = provider.maintenanceRefreshReason({ row, now, context });
    if (!reason) continue;
    if (isInPassiveBackoff(row, now)) continue;
    if (provider.passiveSuppressReason?.({ row, now, context })) continue;
    ensureScheduled(refreshPlan, provider.key, reason);
    forceKeys?.add(provider.key);
  }
}

function applyProviderManualRefresh(refreshPlan, rows, { forceKeys, now, context = {} } = {}) {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.manualRefreshReason) continue;
    const reason = provider.manualRefreshReason({ row: rows[provider.key], now, context });
    if (!reason) continue;
    ensureScheduled(refreshPlan, provider.key, reason);
    forceKeys?.add(provider.key);
  }
}

async function hydrateCurrentReminderState(userId, {
  calendar,
  deadlines,
}, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const calendarItems = Array.isArray(calendar) ? calendar : [];
  const deadlinePayload = deadlines || EMPTY_DEADLINES;
  const deadlineItems = Array.isArray(deadlinePayload?.upcoming)
    ? deadlinePayload.upcoming
    : [];
  try {
    const [hydratedCalendar, hydratedDeadlines] = await Promise.all([
      hydrateCalendarEventsWithReminderState(userId, calendarItems, { dbClient, now }),
      hydrateTodoistTasksWithReminderState(userId, deadlineItems, { dbClient, now }),
    ]);
    return {
      calendar: hydratedCalendar,
      deadlines: {
        ...deadlinePayload,
        upcoming: hydratedDeadlines,
      },
    };
  } catch (err) {
    console.error("[Dashboard] reminder state hydration failed:", err.message);
    return { calendar, deadlines };
  }
}

function usablePayloadForKey(key, row, fallback) {
  return hasUsablePayload(key, row) ? parsePayload(row, fallback) : fallback;
}

async function composeCurrentDashboardResponse(userId, rows, {
  activeSnapshot,
  activeSnapshotHealth = null,
  providerHealth,
  // P0-1/P3-9: the hot getCurrentDashboard path hydrates reminder state inside
  // its parallel batch and passes the result in here, so hydration no longer
  // extends the serial response-composition chain on the every-2s poll. Other
  // callers (force sync / manual refresh) omit it and hydrate inline below.
  // Either way the produced calendar/deadlines payloads are identical.
  hydratedReminderPayloads = null,
  refresh = { mode: "passive", scheduled: [], skipped: [] },
  dbClient = db,
  now = new Date(),
} = {}) {
  const billsPayload = usablePayloadForKey("bills_current", rows.bills_current, fallbackPayloadForKey("bills_current"));

  const nextProviderHealth = { ...providerHealth };
  if (activeSnapshotHealth) nextProviderHealth.activeSnapshot = activeSnapshotHealth;
  const fetchedAt = new Date().toISOString();
  const reminderPayloads = hydratedReminderPayloads || await hydrateCurrentReminderState(userId, {
    calendar: usablePayloadForKey("calendar_current", rows.calendar_current, []),
    deadlines: usablePayloadForKey("deadlines_current", rows.deadlines_current, EMPTY_DEADLINES),
  }, { dbClient, now });

  return {
    weather: usablePayloadForKey("weather_current", rows.weather_current, null),
    calendar: reminderPayloads.calendar,
    deadlines: reminderPayloads.deadlines,
    bills: billsPayload.bills || [],
    allSchedules: billsPayload.allSchedules || [],
    payeeMap: billsPayload.payeeMap || {},
    actualConfigured: !!billsPayload.actualConfigured,
    actualBudgetUrl: billsPayload.actualBudgetUrl || null,
    billsSyncHealth: billsPayload.billsSyncHealth || null,
    activeSnapshot,
    providerHealth: nextProviderHealth,
    systemStatus: composeSystemStatus(nextProviderHealth, { generatedAt: fetchedAt }),
    refresh,
    fetchedAt,
  };
}

async function loadRefreshContext(userId, { dbClient = db } = {}) {
  // P1-7: these two health reads are independent (todoist mirror vs bills mirror
  // tables, no write ordering) — run them concurrently instead of serially. Keep
  // the per-call .catch INSIDE Promise.all so one failing read still degrades
  // gracefully rather than rejecting both.
  const [todoistHealth, billsMirror] = await Promise.all([
    getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err)),
    getBillsMirrorState(userId, { dbClient }).catch(() => null),
  ]);
  return { todoistHealth, billsMirror };
}

export async function getCurrentDashboard(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await refreshMissingRows(
    userId,
    await loadCacheRows(userId, { dbClient }),
    { dbClient, now },
  );
  const context = await loadRefreshContext(userId, { dbClient });
  const refreshPlan = planCurrentDataRefresh(rows, { mode: "passive", now, context });
  applyProviderPassiveSuppression(refreshPlan, rows, { now, context });
  const forceKeys = new Set();
  applyProviderMaintenanceRefresh(refreshPlan, rows, { forceKeys, now, context });
  const scheduledKeys = refreshPlan.scheduled.map((entry) => entry.key);
  const responseRows = await markRowsRefreshing(userId, rows, scheduledKeys, { dbClient, now });
  const refreshReasons = Object.fromEntries(refreshPlan.scheduled.map((entry) => [entry.key, entry.reason]));
  scheduleBackgroundCurrentRefresh(userId, responseRows, scheduledKeys, { dbClient, now, forceKeys, refreshReasons });
  // P1-7: getActiveSnapshotView and loadProviderHealth read disjoint table sets
  // and share no write (markRowsRefreshing already completed above), so resolve
  // them concurrently instead of as serial awaits in the object literal.
  // loadProviderHealth MUST keep receiving context.todoistHealth so it reuses
  // the already-loaded health and does not re-issue its own getTodoistSyncHealth.
  // P0-1/P3-9: hydrateCurrentReminderState reads ea_reminders only (disjoint from
  // the snapshot + provider-health tables), so fold it into the SAME parallel
  // batch instead of letting composeCurrentDashboardResponse await it serially
  // afterward. This removes the last serial DB hop from the every-2s poll path.
  const [activeSnapshot, providerHealth, hydratedReminderPayloads] = await Promise.all([
    getActiveSnapshotView(userId),
    loadProviderHealth(userId, responseRows, { now, todoistHealth: context.todoistHealth }),
    hydrateCurrentReminderState(userId, {
      calendar: usablePayloadForKey("calendar_current", rows.calendar_current, []),
      deadlines: usablePayloadForKey("deadlines_current", rows.deadlines_current, EMPTY_DEADLINES),
    }, { dbClient, now }),
  ]);
  return composeCurrentDashboardResponse(userId, rows, {
    activeSnapshot,
    providerHealth,
    hydratedReminderPayloads,
    refresh: { mode: "passive", ...refreshPlan },
    dbClient,
    now,
  });
}

export async function syncCurrentDashboard(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const refreshPlan = planCurrentDataRefresh({}, { mode: "force", now, force: true });
  // Load existing rows so a provider that times out during a force sync (P1-6)
  // degrades its existing payload via markCacheRowRefreshFailed instead of
  // clobbering a good cached row to "unavailable". force:true still re-fetches
  // every key; the existing rows only feed the failure-fallback and change
  // detection.
  const existingRows = await loadCacheRows(userId, { dbClient });
  const rows = await refreshRows(userId, existingRows, CURRENT_CACHE_KEYS, { dbClient, now, force: true });
  let timer = null;
  const timeoutMs = snapshotSyncTimeoutMs();
  const snapshotResult = await Promise.race([
    syncActiveSnapshot(userId)
      .then((value) => ({ state: "current", value }))
      .catch((err) => ({ state: "stale", reason: "error", error: err })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ state: "stale", reason: "timeout" }), timeoutMs);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);

  const activeSnapshot = snapshotResult.value || await getActiveSnapshotView(userId);
  return composeCurrentDashboardResponse(userId, rows, {
    activeSnapshot,
    providerHealth: await loadProviderHealth(userId, rows, { now }),
    refresh: { mode: "force", ...refreshPlan },
    activeSnapshotHealth: {
      state: snapshotResult.state,
      reason: snapshotResult.reason || null,
      timeoutMs: snapshotResult.reason === "timeout" ? timeoutMs : null,
      errorMessage: snapshotResult.error?.message || null,
    },
    dbClient,
    now,
  });
}

export async function requestCurrentDashboardRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await loadCacheRows(userId, { dbClient });
  const context = await loadRefreshContext(userId, { dbClient });
  const refreshPlan = planCurrentDataRefresh(rows, { mode: "manual", now, context });
  const forceKeys = new Set();
  applyProviderManualRefresh(refreshPlan, rows, { forceKeys, now, context });
  const scheduledKeys = refreshPlan.scheduled.map((entry) => entry.key);
  const responseRows = await markRowsRefreshing(userId, rows, scheduledKeys, { dbClient, now });
  const refreshReasons = Object.fromEntries(refreshPlan.scheduled.map((entry) => [entry.key, entry.reason]));
  scheduleBackgroundCurrentRefresh(userId, responseRows, scheduledKeys, { dbClient, now, forceKeys, refreshReasons });
  const shouldSyncSnapshot = true;
  if (shouldSyncSnapshot) {
    syncActiveSnapshot(userId)
      .catch((err) => console.error("[Dashboard] active snapshot background sync failed:", err.message));
  }
  const refresh = {
    mode: "manual",
    scheduled: shouldSyncSnapshot
      ? [...refreshPlan.scheduled, scheduledEntry("active_snapshot", "manual_retry")]
      : refreshPlan.scheduled,
    skipped: refreshPlan.skipped,
  };
  // The inline getActiveSnapshotView returns the CURRENT briefing immediately so the
  // manual-refresh response carries a snapshot the frontend renders right away
  // (useCurrentDashboard exposes current.activeSnapshot to the UI). The fire-and-forget
  // syncActiveSnapshot above fetches new mail, re-triages, and rebuilds the view in the
  // background; its trailing rebuild reaches the client via the next SSE/poll. The two
  // reads happen at different moments for different consumers, this inline read is already
  // concurrency-bounded (P1-7), and this is the low-frequency manual-refresh path — so the
  // second post-sync rebuild is accepted rather than returning a lightweight inline
  // snapshot, which would blank the rendered briefing until the next poll and change the
  // /current/refresh contract.
  // These two tail reads are independent (a snapshot-view build and a
  // provider-health read), so overlap them instead of paying their Turso
  // round-trips serially on every manual/return-to-dashboard refresh.
  const [activeSnapshot, providerHealth] = await Promise.all([
    getActiveSnapshotView(userId),
    loadProviderHealth(userId, responseRows, { now, todoistHealth: context.todoistHealth }),
  ]);
  return composeCurrentDashboardResponse(userId, rows, {
    activeSnapshot,
    providerHealth,
    refresh,
    activeSnapshotHealth: {
      state: shouldSyncSnapshot ? "syncing" : "current",
      reason: "background",
      timeoutMs: null,
      errorMessage: null,
    },
    dbClient,
    now,
  });
}

export async function requestBillsCurrentMaintenanceRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await loadCacheRows(userId, { dbClient });
  const billsMirror = await getBillsMirrorState(userId, { dbClient }).catch(() => null);
  const refreshPlan = { scheduled: [], skipped: [] };
  const forceKeys = new Set();
  applyProviderMaintenanceRefresh(refreshPlan, rows, { forceKeys, now, context: { billsMirror } });
  const scheduledKeys = refreshPlan.scheduled.map((entry) => entry.key);
  if (!scheduledKeys.length) return { scheduled: false, due: false };
  const responseRows = await markRowsRefreshing(userId, rows, scheduledKeys, { dbClient, now });
  const refreshReasons = Object.fromEntries(refreshPlan.scheduled.map((entry) => [entry.key, entry.reason]));
  scheduleBackgroundCurrentRefresh(userId, responseRows, scheduledKeys, { dbClient, now, forceKeys, refreshReasons });
  return { scheduled: true, due: true, refresh: refreshPlan };
}

export async function getDashboardSystemHealth(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await loadCacheRows(userId, { dbClient });
  const providerHealth = await loadProviderHealth(userId, rows, { now });
  return {
    providerHealth,
    systemStatus: composeSystemStatus(providerHealth),
    fetchedAt: new Date().toISOString(),
  };
}
