import db from "../db/connection.js";
import {
  clearPendingBillsMirrorRefresh,
  consumeDueBillsMirrorRefresh,
  getBillsMirrorState,
  isBillsMirrorMaintenanceDue,
  readBillsMirrorCurrent,
  refreshBillsMirror,
  scheduleBillsMirrorRefresh,
} from "../briefing/bills-service.js";
import { publishCurrentDashboardEvent } from "./current-events.js";
import { fetchCalendar } from "../briefing/calendar.js";
import { fetchCTMDeadlines } from "../briefing/ctm.js";
import {
  computeDeadlineStats,
  loadCompletedTaskIds,
  separateDeadlines,
} from "../briefing/deadline-helpers.js";
import { loadUserConfig } from "../briefing/config-service.js";
import { getActiveSnapshotView, syncActiveSnapshot } from "../briefing/snapshot-service.js";
import { fetchTodoistDueTaskIdSet, fetchTodoistTasks, getTodoistSyncHealth } from "../briefing/todoist.js";
import { hydrateRecurringTombstones } from "../briefing/tombstones.js";
import { fetchWeather } from "../briefing/weather.js";
import {
  CURRENT_CACHE_KEYS,
  EMPTY_DEADLINES,
  expiresAtFor,
  fallbackPayloadForKey,
  hasUsablePayload,
  isRefreshTimedOut,
  parsePayload,
  shouldPublishBillsCurrentChange,
  sourceHealthForRow,
  summarizeCurrentDataHealth,
} from "./current-sources.js";

const PASSIVE_FAILURE_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const BILLS_PASSIVE_PROVIDER_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_SYNC_TIMEOUT_MS = 2_500;
const BACKGROUND_REFRESH_IN_FLIGHT = new Map();

export function __resetCurrentDashboardRefreshStateForTests() {
  BACKGROUND_REFRESH_IN_FLIGHT.clear();
}

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

function publishBillsCurrentChange(userId, previousRow, nextPayload, {
  now = new Date(),
  reason = "changed",
} = {}) {
  if (!shouldPublishBillsCurrentChange(previousRow, nextPayload)) return;
  publishCurrentDashboardEvent(userId, {
    source: "bills",
    reason,
    state: "current",
    occurredAt: now.toISOString(),
  });
}

export async function applyDeadlineCurrentStatus(userId, taskId, status, {
  dbClient = db,
  now = new Date(),
  source = null,
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
  const sections = source === "todoist" ? ["todoist"] : source === "ctm" ? ["ctm"] : ["ctm", "todoist"];
  for (const section of sections) {
    const upcoming = payload?.[section]?.upcoming;
    if (!Array.isArray(upcoming)) continue;
    let sectionUpdated = false;
    for (const task of upcoming) {
      if (String(task?.id) !== String(taskId)) continue;
      task.status = status;
      delete task._completing;
      sectionUpdated = true;
      updated = true;
    }
    if (sectionUpdated) {
      payload[section].stats = computeDeadlineStats(upcoming);
    }
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

async function refreshWeatherCurrent(userId, config, options) {
  const settings = config.settings || {};
  const payload = {
    ...(await fetchWeather(settings.weather_lat || 34.1442, settings.weather_lng || -117.9981)),
    location: settings.weather_location || "El Monte, CA",
  };
  await saveCacheRow(userId, "weather_current", payload, options);
  return payload;
}

async function refreshCalendarCurrent(userId, config, options) {
  const calendarAccounts = (config.accounts || []).filter(
    (account) => account.type === "gmail" && account.calendar_enabled,
  );
  const payload = await fetchCalendar(calendarAccounts);
  await saveCacheRow(userId, "calendar_current", payload, options);
  return payload;
}

async function refreshDeadlinesCurrent(userId, _config, options) {
  const [ctmDeadlines, todoistTasks, todoistDueTaskIds] = await Promise.all([
    fetchCTMDeadlines().catch((err) => {
      console.error("[Dashboard] CTM current refresh failed:", err.message);
      return [];
    }),
    fetchTodoistTasks(userId, { refresh: !!options.force }).catch((err) => {
      console.error("[Dashboard] Todoist current refresh failed:", err.message);
      return [];
    }),
    fetchTodoistDueTaskIdSet(userId, { refresh: !!options.force }).catch((err) => {
      console.error("[Dashboard] Todoist id-set current refresh failed:", err.message);
      return null;
    }),
  ]);
  const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
  const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "today",
  });
  const todoistWithCompleted = [...separated.todoist, ...tombstones];
  const payload = {
    ctm: {
      upcoming: separated.ctm,
      stats: computeDeadlineStats(separated.ctm),
    },
    todoist: {
      upcoming: todoistWithCompleted,
      stats: computeDeadlineStats(todoistWithCompleted),
    },
  };
  await saveCacheRow(userId, "deadlines_current", payload, options);
  return payload;
}

async function refreshBillsCurrent(userId, config, options) {
  const actualBudgetUrl = config.settings?.actual_budget_url || null;
  if (!actualBudgetUrl) {
    const payload = await refreshBillsMirror(userId, { ...options, actualBudgetUrl: null });
    await saveCacheRow(userId, "bills_current", payload, options);
    return payload;
  }

  let payload;
  const dueRefresh = options.force
    ? false
    : await consumeDueBillsMirrorRefresh(userId, options).catch((err) => {
        console.error("[Dashboard] Bills mirror due-refresh check failed:", err.message);
        return false;
      });
  if (options.force || dueRefresh) {
    await clearPendingBillsMirrorRefresh(userId, options);
    payload = await refreshBillsMirror(userId, { ...options, actualBudgetUrl });
  } else {
    payload = await readBillsMirrorCurrent(userId, options);
    if (payload.billsSyncHealth?.state === "needs_sync") {
      scheduleBillsMirrorRefresh(userId, options).catch((err) => {
        console.error("[Dashboard] Bills mirror refresh scheduling failed:", err.message);
      });
    }
  }
  await saveCacheRow(userId, "bills_current", payload, options);
  return payload;
}

const DOMAIN_REFRESHERS = {
  weather_current: refreshWeatherCurrent,
  calendar_current: refreshCalendarCurrent,
  deadlines_current: refreshDeadlinesCurrent,
  bills_current: refreshBillsCurrent,
};

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
    try {
      const payload = await DOMAIN_REFRESHERS[key](userId, config, { dbClient, now, force });
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
      if (key === "bills_current") {
        publishBillsCurrentChange(userId, rows[key], payload, {
          now,
          reason: refreshReasons[key] === "bills_mirror_maintenance_due" ? "maintenance_refreshed" : "changed",
        });
      }
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
    nextRows[key] = {
      user_id: userId,
      cache_key: key,
      payload_json: currentPayload,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      status: "refreshing",
      error_message: null,
      refresh_started_at: timestamp,
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

function newestFailureTime(values) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : null;
}

function isInBillsProviderFailureBackoff(row, billsMirror, now) {
  const failureTime = newestFailureTime([
    row?.last_refresh_failed_at,
    billsMirror?.syncHealth?.lastAttemptAt,
  ]);
  if (!failureTime) return false;
  const rowFailed = Number(row?.refresh_failure_count || 0) > 0;
  const mirrorFailed = billsMirror?.syncHealth?.state === "degraded" || billsMirror?.syncHealth?.state === "unavailable";
  if (!rowFailed && !mirrorFailed) return false;
  return now.getTime() - failureTime < BILLS_PASSIVE_PROVIDER_FAILURE_BACKOFF_MS;
}

function suppressBillsPassiveRefreshDuringProviderBackoff(refreshPlan, rows, billsMirror, {
  now,
} = {}) {
  if (!isInBillsProviderFailureBackoff(rows.bills_current, billsMirror, now)) return;
  const scheduledBefore = refreshPlan.scheduled.length;
  refreshPlan.scheduled = refreshPlan.scheduled.filter((entry) => entry.key !== "bills_current");
  if (refreshPlan.scheduled.length !== scheduledBefore) {
    refreshPlan.skipped.push(skippedEntry("bills_current", "provider_backoff"));
  }
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

function hasTodoistNeedsSync(todoistHealth) {
  return todoistHealth?.state === "needs_sync" || todoistHealth?.state === "stale";
}

function isTodoistMirrorNewerThanDeadlines(todoistHealth, row) {
  if (!todoistHealth?.lastSuccessAt || !row?.fetched_at) return false;
  return new Date(todoistHealth.lastSuccessAt).getTime() > new Date(row.fetched_at).getTime();
}

function planCurrentDataRefresh(rows, {
  mode,
  now,
  force = false,
  todoistHealth = null,
} = {}) {
  const scheduled = [];
  const skipped = [];
  for (const key of CURRENT_CACHE_KEYS) {
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
    if (
      key === "deadlines_current"
      && (hasTodoistNeedsSync(todoistHealth) || isTodoistMirrorNewerThanDeadlines(todoistHealth, row))
    ) {
      scheduled.push(scheduledEntry(key, "needs_sync"));
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

function applyBillsMirrorMaintenanceRefresh(refreshPlan, rows, billsMirror, {
  forceKeys,
  now,
} = {}) {
  if (!isBillsMirrorMaintenanceDue(billsMirror?.syncHealth, { now })) return;
  if (isInPassiveBackoff(rows.bills_current, now)) return;
  if (isInBillsProviderFailureBackoff(rows.bills_current, billsMirror, now)) return;
  ensureScheduled(refreshPlan, "bills_current", "bills_mirror_maintenance_due");
  forceKeys?.add("bills_current");
}

function composeCurrentDashboardResponse(rows, {
  activeSnapshot,
  activeSnapshotHealth = null,
  providerHealth,
  refresh = { mode: "passive", scheduled: [], skipped: [] },
} = {}) {
  const billsPayload = parsePayload(rows.bills_current, {
    bills: [],
    allSchedules: [],
    payeeMap: {},
    actualConfigured: false,
    actualBudgetUrl: null,
  });

  const nextProviderHealth = { ...providerHealth };
  if (activeSnapshotHealth) nextProviderHealth.activeSnapshot = activeSnapshotHealth;
  const fetchedAt = new Date().toISOString();

  return {
    weather: parsePayload(rows.weather_current, null),
    calendar: parsePayload(rows.calendar_current, []),
    deadlines: parsePayload(rows.deadlines_current, EMPTY_DEADLINES),
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

export async function getCurrentDashboard(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await refreshMissingRows(
    userId,
    await loadCacheRows(userId, { dbClient }),
    { dbClient, now },
  );
  const todoistHealth = await getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err));
  const billsMirror = await getBillsMirrorState(userId, { dbClient }).catch(() => null);
  const refreshPlan = planCurrentDataRefresh(rows, { mode: "passive", now, todoistHealth });
  suppressBillsPassiveRefreshDuringProviderBackoff(refreshPlan, rows, billsMirror, { now });
  const forceKeys = new Set();
  applyBillsMirrorMaintenanceRefresh(refreshPlan, rows, billsMirror, { forceKeys, now });
  const scheduledKeys = refreshPlan.scheduled.map((entry) => entry.key);
  const responseRows = await markRowsRefreshing(userId, rows, scheduledKeys, { dbClient, now });
  const refreshReasons = Object.fromEntries(refreshPlan.scheduled.map((entry) => [entry.key, entry.reason]));
  scheduleBackgroundCurrentRefresh(userId, responseRows, scheduledKeys, { dbClient, now, forceKeys, refreshReasons });
  return composeCurrentDashboardResponse(rows, {
    activeSnapshot: await getActiveSnapshotView(userId),
    providerHealth: await loadProviderHealth(userId, responseRows, { now, todoistHealth }),
    refresh: { mode: "passive", ...refreshPlan },
  });
}

export async function syncCurrentDashboard(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const refreshPlan = planCurrentDataRefresh({}, { mode: "force", now, force: true });
  const rows = await refreshRows(userId, {}, CURRENT_CACHE_KEYS, { dbClient, now, force: true });
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
  return composeCurrentDashboardResponse(rows, {
    activeSnapshot,
    providerHealth: await loadProviderHealth(userId, rows, { now }),
    refresh: { mode: "force", ...refreshPlan },
    activeSnapshotHealth: {
      state: snapshotResult.state,
      reason: snapshotResult.reason || null,
      timeoutMs: snapshotResult.reason === "timeout" ? timeoutMs : null,
      errorMessage: snapshotResult.error?.message || null,
    },
  });
}

export async function requestCurrentDashboardRefresh(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await loadCacheRows(userId, { dbClient });
  const todoistHealth = await getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err));
  const billsMirror = await getBillsMirrorState(userId, { dbClient }).catch(() => null);
  const refreshPlan = planCurrentDataRefresh(rows, { mode: "manual", now, todoistHealth });
  const forceKeys = new Set();
  if (billsMirror?.syncHealth?.pendingRefreshAt) {
    ensureScheduled(refreshPlan, "bills_current", "pending_bills_mirror");
    forceKeys.add("bills_current");
  } else {
    ensureScheduled(refreshPlan, "bills_current", "manual_bills_sync");
    forceKeys.add("bills_current");
  }
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
  return composeCurrentDashboardResponse(rows, {
    activeSnapshot: await getActiveSnapshotView(userId),
    providerHealth: await loadProviderHealth(userId, responseRows, { now, todoistHealth }),
    refresh,
    activeSnapshotHealth: {
      state: shouldSyncSnapshot ? "syncing" : "current",
      reason: "background",
      timeoutMs: null,
      errorMessage: null,
    },
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
  applyBillsMirrorMaintenanceRefresh(refreshPlan, rows, billsMirror, { forceKeys, now });
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
