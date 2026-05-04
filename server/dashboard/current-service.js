import db from "../db/connection.js";
import { getUpcomingBills, getMetadata as getActualMetadata, isSchedulePaid } from "../briefing/actual.js";
import { fetchCalendar } from "../briefing/calendar.js";
import { fetchCTMDeadlines } from "../briefing/ctm.js";
import {
  computeDeadlineStats,
  loadCompletedTaskIds,
  loadUserConfig,
  separateDeadlines,
} from "../briefing/index.js";
import { getActiveSnapshotView, syncActiveSnapshot } from "../briefing/snapshot-service.js";
import { fetchTodoistTasks, getTodoistSyncHealth } from "../briefing/todoist.js";
import { hydrateRecurringTombstones } from "../briefing/tombstones.js";
import { fetchWeather } from "../briefing/weather.js";

export const CURRENT_CACHE_KEYS = [
  "weather_current",
  "calendar_current",
  "deadlines_current",
  "bills_current",
];

const EMPTY_DEADLINES = {
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
};
const CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_SYNC_TIMEOUT_MS = 2_500;

function parsePayload(row, fallback) {
  if (!row?.payload_json) return fallback;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return fallback;
  }
}

function isFresh(row, now = new Date()) {
  if (!row?.expires_at) return false;
  return new Date(row.expires_at).getTime() > now.getTime();
}

function rowHealthState(row, now) {
  if (!row) return "unavailable";
  if (row.status === "unavailable") return "unavailable";
  if (row.status === "refreshing" || row.refresh_started_at) return "refreshing";
  return isFresh(row, now) ? "current" : "stale";
}

function maxIso(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function summarizeCurrentDataHealth(rows, now) {
  const sourceRows = CURRENT_CACHE_KEYS.map((key) => rows[key]).filter(Boolean);
  const sourceStates = CURRENT_CACHE_KEYS.map((key) => rowHealthState(rows[key], now));

  const state = sourceStates.includes("unavailable")
    ? "unavailable"
    : sourceStates.includes("stale")
      ? "stale"
      : sourceStates.includes("refreshing")
        ? "refreshing"
        : "current";

  return {
    state,
    lastSuccessAt: maxIso(sourceRows.map((row) => row.fetched_at)),
    sources: CURRENT_CACHE_KEYS.map((key) => {
      const row = rows[key];
      return {
        key,
        state: rowHealthState(row, now),
        fetchedAt: row?.fetched_at || null,
        expiresAt: row?.expires_at || null,
        errorMessage: row?.error_message || null,
      };
    }),
  };
}

async function loadCacheRows(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message, refresh_started_at
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
    lastSuccessAt: null,
    lastError: err?.message || "Todoist sync health unavailable",
    syncStartedAt: null,
    ageMs: null,
  };
}

async function loadProviderHealth(userId, rows, { now = new Date() } = {}) {
  const currentData = summarizeCurrentDataHealth(rows, now);
  const todoist = await getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err));
  return { currentData, todoist };
}

function currentDataMessage(state) {
  if (state === "current") return "Current dashboard data is fresh.";
  if (state === "refreshing") return "Current dashboard data is refreshing.";
  if (state === "stale") return "Some current dashboard data is stale.";
  return "Some current dashboard data is unavailable.";
}

function todoistMessage(health) {
  if (!health?.configured || health.state === "unconfigured") return "Todoist is not configured.";
  if (health.state === "current") return "Todoist mirror is current.";
  if (health.state === "syncing") return "Todoist mirror is syncing.";
  if (health.state === "stale") return "Todoist mirror is stale.";
  return "Todoist mirror is unavailable.";
}

function summarizeSystemState(sources) {
  const configuredSources = sources.filter((source) => source.state !== "unconfigured");
  const states = configuredSources.map((source) => source.state);
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("stale")) return "stale";
  if (states.includes("syncing")) return "syncing";
  if (states.includes("refreshing")) return "refreshing";
  return "current";
}

function composeSystemStatus(providerHealth, { generatedAt = new Date().toISOString() } = {}) {
  const todoistState = providerHealth.todoist?.state || "unavailable";
  const sources = [
    {
      key: "currentData",
      label: "Current data",
      state: providerHealth.currentData.state,
      lastSuccessAt: providerHealth.currentData.lastSuccessAt || null,
      message: currentDataMessage(providerHealth.currentData.state),
    },
    {
      key: "todoist",
      label: "Todoist",
      state: todoistState,
      lastSuccessAt: providerHealth.todoist?.lastSuccessAt || null,
      message: todoistMessage(providerHealth.todoist),
    },
  ];

  return {
    state: summarizeSystemState(sources),
    sources,
    generatedAt,
  };
}

function expiresAtFor(now) {
  return new Date(now.getTime() + CACHE_TTL_MS).toISOString();
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
            updated_at = excluded.updated_at`,
    args: [
      userId,
      cacheKey,
      JSON.stringify(payload),
      timestamp,
      expiresAtFor(now),
      status,
      errorMessage,
      timestamp,
    ],
  });
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
  const [ctmDeadlines, todoistTasks] = await Promise.all([
    fetchCTMDeadlines().catch((err) => {
      console.error("[Dashboard] CTM current refresh failed:", err.message);
      return [];
    }),
    fetchTodoistTasks(userId, { refresh: !!options.force }).catch((err) => {
      console.error("[Dashboard] Todoist current refresh failed:", err.message);
      return [];
    }),
  ]);
  const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
  const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
  const liveTodoistIds = new Set(todoistTasks.map((task) => String(task.id)));
  const tombstones = await hydrateRecurringTombstones(userId, liveTodoistIds, {
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
    const payload = {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: false,
      actualBudgetUrl: null,
    };
    await saveCacheRow(userId, "bills_current", payload, options);
    return payload;
  }

  const [bills, metadata] = await Promise.all([
    getUpcomingBills(userId),
    getActualMetadata(userId),
  ]);
  const payload = {
    bills,
    allSchedules: (metadata.schedules || []).map((schedule) => ({
      ...schedule,
      paid: isSchedulePaid(schedule, metadata.recentTransactions || []),
    })),
    payeeMap: metadata.payeeMap || {},
    actualConfigured: true,
    actualBudgetUrl,
  };
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
        expires_at: expiresAtFor(now),
        status: "current",
        error_message: null,
      };
    } catch (err) {
      const fallback = key === "weather_current"
        ? null
        : key === "calendar_current"
          ? []
          : key === "deadlines_current"
            ? EMPTY_DEADLINES
            : { bills: [], allSchedules: [], payeeMap: {}, actualConfigured: false, actualBudgetUrl: null };
      console.error(`[Dashboard] ${key} refresh failed:`, err.message);
      await saveCacheRow(userId, key, fallback, {
        dbClient,
        now,
        status: "unavailable",
        errorMessage: err.message,
      });
      refreshedRows[key] = {
        user_id: userId,
        cache_key: key,
        payload_json: JSON.stringify(fallback),
        fetched_at: now.toISOString(),
        expires_at: expiresAtFor(now),
        status: "unavailable",
        error_message: err.message,
      };
    }
  }));
  return refreshedRows;
}

async function refreshMissingRows(userId, rows, options) {
  const missingKeys = CURRENT_CACHE_KEYS.filter((key) => !rows[key]);
  return refreshRows(userId, rows, missingKeys, options);
}

function refreshStaleRowsInBackground(userId, rows, options) {
  const staleKeys = CURRENT_CACHE_KEYS.filter((key) => rows[key] && !isFresh(rows[key], options.now));
  if (!staleKeys.length) return;
  Promise.resolve()
    .then(() => refreshRows(userId, rows, staleKeys, options))
    .catch((err) => console.error("[Dashboard] background current refresh failed:", err.message));
}

function composeCurrentDashboardResponse(rows, {
  activeSnapshot,
  activeSnapshotHealth = null,
  providerHealth,
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
    activeSnapshot,
    providerHealth: nextProviderHealth,
    systemStatus: composeSystemStatus(nextProviderHealth, { generatedAt: fetchedAt }),
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
  refreshStaleRowsInBackground(userId, rows, { dbClient, now });
  return composeCurrentDashboardResponse(rows, {
    activeSnapshot: await getActiveSnapshotView(userId),
    providerHealth: await loadProviderHealth(userId, rows, { now }),
  });
}

export async function syncCurrentDashboard(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
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
    activeSnapshotHealth: {
      state: snapshotResult.state,
      reason: snapshotResult.reason || null,
      timeoutMs: snapshotResult.reason === "timeout" ? timeoutMs : null,
      errorMessage: snapshotResult.error?.message || null,
    },
  });
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
