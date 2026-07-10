// Engine for the /api/dashboard/current envelope. All provider-specific
// behavior (fetching, publish-on-change, backoff, maintenance) lives on the
// provider modules in current-providers/; this file owns cache rows, refresh
// planning/scheduling, and response composition.
import db from "../db/connection.js";
import { getBillsMirrorState } from "../bills/bills-service.js";
import { publishCurrentDashboardEvent } from "./current-events.js";
import { computeDeadlineStats } from "../tasks/deadline-helpers.js";
import { getActiveSnapshotView, syncActiveSnapshot } from "../snapshots/snapshot-service.js";
import { getTodoistSyncHealth } from "../tasks/todoist.js";
import {
  hydrateCalendarEventsWithReminderState,
  hydrateTodoistTasksWithReminderState,
} from "../reminders/reminder-hydration.js";
import {
  CURRENT_CACHE_KEYS,
  currentResponseContentKey,
  EMPTY_DEADLINES,
  fallbackPayloadForKey,
  hasUsablePayload,
  parsePayload,
  summarizeCurrentDataHealth,
} from "./current-sources.js";
import { composeSystemStatus } from "./currentSystemStatusModel.js";
import {
  planCurrentDataRefresh,
  applyProviderPassiveSuppression,
  applyProviderMaintenanceRefresh,
  applyProviderManualRefresh,
  scheduledEntry,
} from "./currentRefreshPlanModel.js";
import {
  loadCacheRows,
  markCacheRowRefreshFailed,
  markRowsRefreshing,
} from "./currentCacheStore.js";
import {
  refreshRows,
  scheduleBackgroundCurrentRefresh,
  refreshMissingRows,
} from "./currentRefreshRunner.js";
export {
  __resetCurrentDashboardRefreshStateForTests,
  __waitForCurrentDashboardRefreshesForTests,
} from "./currentRefreshRunner.js";

const SNAPSHOT_SYNC_TIMEOUT_MS = 2_500;

export const __currentDashboardInternalsForTests = {
  markRowsRefreshing,
  markCacheRowRefreshFailed,
};

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

  const response = {
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
  // Content fingerprint over everything except the per-response wall-clock fields,
  // so a poll/SSE refetch that returns unchanged data carries an identical
  // contentKey and the client (useCurrentDashboard) can skip re-rendering.
  return { ...response, contentKey: currentResponseContentKey(response) };
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
  // loadCacheRows (ea_current_data_cache) and loadRefreshContext (todoist + bills
  // mirror health) read disjoint tables and nothing written before this point
  // feeds either, so overlap them instead of paying two serial Turso round-trips
  // up front on every poll. refreshMissingRows only writes on a cold/missing row,
  // which loadRefreshContext does not read.
  const [cacheRows, context] = await Promise.all([
    loadCacheRows(userId, { dbClient }),
    loadRefreshContext(userId, { dbClient }),
  ]);
  const rows = await refreshMissingRows(userId, cacheRows, { dbClient, now });
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

async function loadReauthHealth(userId, { dbClient = db } = {}) {
  const [accountsResult, settingsResult] = await Promise.all([
    dbClient.execute({
      sql: "SELECT id, email, type FROM ea_accounts WHERE user_id = ? AND needs_reauth = 1",
      args: [userId],
    }),
    dbClient.execute({
      sql: "SELECT todoist_needs_reauth FROM ea_settings WHERE user_id = ?",
      args: [userId],
    }),
  ]);
  return {
    accounts: accountsResult.rows.map((row) => ({ id: row.id, email: row.email, type: row.type })),
    todoist: !!settingsResult.rows[0]?.todoist_needs_reauth,
  };
}

export async function getDashboardSystemHealth(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const rows = await loadCacheRows(userId, { dbClient });
  const [providerHealth, reauth] = await Promise.all([
    loadProviderHealth(userId, rows, { now }),
    loadReauthHealth(userId, { dbClient }),
  ]);
  providerHealth.reauth = reauth;
  return {
    providerHealth,
    systemStatus: composeSystemStatus(providerHealth),
    fetchedAt: new Date().toISOString(),
  };
}
