import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";

type TestMock = Mock<(...args: unknown[]) => unknown>;
interface CurrentServiceTestState {
  db: { current: Client };
  fetchWeather: TestMock;
  fetchCalendar: TestMock;
  fetchTodoistDueTaskIdSet: TestMock;
  fetchTodoistTasks: TestMock;
  getTodoistSyncHealth: TestMock;
  hydrateRecurringTombstones: TestMock;
  filterCompletedTodoistTasks: TestMock;
  readBillsMirrorCurrent: TestMock;
  refreshBillsMirror: TestMock;
  getBillsMirrorState: TestMock;
  consumeDueBillsMirrorRefresh: TestMock;
  clearPendingBillsMirrorRefresh: TestMock;
  scheduleBillsMirrorRefresh: TestMock;
  getActiveSnapshotView: TestMock;
  syncActiveSnapshot: TestMock;
}

const testState = vi.hoisted((): CurrentServiceTestState => ({
  db: { current: null as unknown as Client },
  fetchWeather: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  filterCompletedTodoistTasks: vi.fn(),
  readBillsMirrorCurrent: vi.fn(),
  refreshBillsMirror: vi.fn(),
  getBillsMirrorState: vi.fn(),
  consumeDueBillsMirrorRefresh: vi.fn(),
  clearPendingBillsMirrorRefresh: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
  getActiveSnapshotView: vi.fn(),
  syncActiveSnapshot: vi.fn(),
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    executeMultiple: (sql: string) => testState.db.current.executeMultiple(sql),
    batch: (statements: InStatement[]) => testState.db.current.batch(statements),
  },
}));
vi.mock("../platform/config-service.ts", () => ({
  loadUserConfig: vi.fn(async () => ({
    accounts: [
      { id: "gmail-a", type: "gmail", calendar_enabled: true, label: "Work" },
    ],
    settings: {
      weather_lat: 34.1442,
      weather_lng: -117.9981,
      weather_location: "El Monte, CA",
      actual_budget_url: "https://actual.example.test",
    },
  })),
}));
vi.mock("../tasks/deadline-helpers.ts", () => ({
  loadCompletedTaskIds: vi.fn(async () => new Set()),
  filterCompletedTodoistTasks: (...args: unknown[]) => testState.filterCompletedTodoistTasks(...args),
  computeDeadlineStats: vi.fn((items: unknown[]) => ({ total: items.length })),
}));
vi.mock("../platform/weather.ts", () => ({
  fetchWeather: (...args: unknown[]) => testState.fetchWeather(...args),
}));
vi.mock("../calendar/calendar.ts", () => ({
  fetchCalendar: (...args: unknown[]) => testState.fetchCalendar(...args),
}));
vi.mock("../tasks/todoist.ts", () => ({
  fetchTodoistDueTaskIdSet: (...args: unknown[]) => testState.fetchTodoistDueTaskIdSet(...args),
  fetchTodoistTasks: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksAll: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksRange: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  getTodoistSyncHealth: (...args: unknown[]) => testState.getTodoistSyncHealth(...args),
}));
vi.mock("../tasks/tombstones.ts", () => ({
  hydrateRecurringTombstones: (...args: unknown[]) => testState.hydrateRecurringTombstones(...args),
}));
vi.mock("../bills/bills-service.ts", () => ({
  readBillsMirrorCurrent: (...args: unknown[]) => testState.readBillsMirrorCurrent(...args),
  refreshBillsMirror: (...args: unknown[]) => testState.refreshBillsMirror(...args),
  getBillsMirrorState: (...args: unknown[]) => testState.getBillsMirrorState(...args),
  isBillsMirrorMaintenanceDue: (health: Record<string, unknown> | null, { now = new Date() }: { now?: Date } = {}) => {
    if (!health || health.configured !== true) return false;
    if (health.pendingRefreshAt || health.refreshStartedAt) return false;
    if (health.state !== "current" && health.state !== "degraded") return false;
    const lastSuccess = new Date(String(health.lastSuccessAt || "")).getTime();
    return Number.isFinite(lastSuccess) && now.getTime() - lastSuccess >= 15 * 60 * 1000;
  },
  consumeDueBillsMirrorRefresh: (...args: unknown[]) => testState.consumeDueBillsMirrorRefresh(...args),
  clearPendingBillsMirrorRefresh: (...args: unknown[]) => testState.clearPendingBillsMirrorRefresh(...args),
  scheduleBillsMirrorRefresh: (...args: unknown[]) => testState.scheduleBillsMirrorRefresh(...args),
  shouldScheduleImmediateBillsRefresh: (health: Record<string, unknown> | null, now?: Date) => {
    if (health?.state !== "needs_sync") return false;
    const pendingAt = health?.pendingRefreshAt ? new Date(String(health.pendingRefreshAt)).getTime() : null;
    return pendingAt === null || pendingAt <= new Date(now ?? Date.now()).getTime();
  },
}));
vi.mock("../snapshots/snapshot-service.ts", () => ({
  getActiveSnapshotView: (...args: unknown[]) => testState.getActiveSnapshotView(...args),
  syncActiveSnapshot: (...args: unknown[]) => testState.syncActiveSnapshot(...args),
}));

process.env.EA_USER_ID = "u1";

const EMPTY_DEADLINES_FOR_TEST = {
  upcoming: [],
  stats: null,
};

const {
  clearCurrentDashboardRefreshState,
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} = await import("./current-service.ts");
const { markRowsRefreshing, markCacheRowRefreshFailed } = await import("./currentCacheStore.ts");

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_current_data_cache (
      user_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json TEXT,
      fetched_at TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'current',
      error_message TEXT,
      refresh_started_at TEXT,
      last_refresh_failed_at TEXT,
      last_refresh_error TEXT,
      refresh_failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, cache_key)
    );

    CREATE TABLE ea_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_account_id TEXT,
      source_calendar_id TEXT,
      source_item_id TEXT NOT NULL,
      source_occurrence_id TEXT,
      anchor_kind TEXT NOT NULL,
      anchor_at TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_after TEXT,
      payload_snapshot_json TEXT,
      sent_at TEXT,
      missed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      email TEXT,
      label TEXT,
      needs_reauth INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      todoist_needs_reauth INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

async function seedCache(
  cacheKey: string,
  payload: unknown,
  { fetchedAt, expiresAt }: { fetchedAt?: string; expiresAt?: string } = {},
) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, updated_at)
          VALUES (?, ?, ?, ?, ?, 'current', ?)`,
    args: [
      "u1",
      cacheKey,
      JSON.stringify(payload),
      fetchedAt || new Date().toISOString(),
      expiresAt || new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    ],
  });
}

async function getCurrentResponse() {
  return {
    status: 200,
    body: await getCurrentDashboard("u1", { dbClient: testState.db.current }),
  };
}

async function requestRefreshResponse() {
  return {
    status: 200,
    body: await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current }),
  };
}

async function syncResponse() {
  return {
    status: 200,
    body: await syncCurrentDashboard("u1", { dbClient: testState.db.current }),
  };
}

describe("GET /api/dashboard/current", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    delete process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS;
    delete process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS;
    testState.fetchWeather.mockReset().mockResolvedValue({ temp: 72 });
    testState.fetchCalendar.mockReset().mockResolvedValue([]);
    testState.fetchTodoistTasks.mockReset().mockResolvedValue([]);
    testState.fetchTodoistDueTaskIdSet.mockReset().mockResolvedValue(new Set());
    testState.filterCompletedTodoistTasks.mockReset().mockImplementation((...args: unknown[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] as Array<Record<string, unknown>> : [];
      const completedIds = args[1] instanceof Set ? args[1] : new Set<unknown>();
      return tasks.filter((task) => !completedIds.has(task.id) && !completedIds.has(String(task.id)));
    });
    testState.getTodoistSyncHealth.mockReset().mockResolvedValue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-04T12:00:00.000Z",
      lastError: null,
      syncStartedAt: null,
      ageMs: 30_000,
    });
    testState.hydrateRecurringTombstones.mockReset().mockResolvedValue([]);
    testState.readBillsMirrorCurrent.mockReset().mockResolvedValue({
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    testState.refreshBillsMirror.mockReset().mockResolvedValue({
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    testState.getBillsMirrorState.mockReset().mockResolvedValue({
      syncHealth: { state: "current", configured: true, pendingRefreshAt: null },
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.consumeDueBillsMirrorRefresh.mockReset().mockResolvedValue(false);
    testState.clearPendingBillsMirrorRefresh.mockReset().mockResolvedValue(undefined);
    testState.scheduleBillsMirrorRefresh.mockReset().mockResolvedValue({ pendingRefreshAt: "2026-05-04T12:00:00.000Z" });
    testState.getActiveSnapshotView.mockReset().mockResolvedValue({
      snapshot: { id: 42 },
      lanes: { needs_attention: [], fyi: [], noise: [] },
      carryover: [],
      laneCounts: { needs_attention: 0, fyi: 0, noise: 0, carryover: 0 },
    });
    testState.syncActiveSnapshot.mockReset().mockResolvedValue({ snapshot: { id: 43 } });
  });

  afterEach(async () => {
    clearCurrentDashboardRefreshState();
    await testState.db.current?.close?.();
    testState.db.current = null as unknown as Client;
  });

  it("starts a background current refresh and returns cached rows without waiting for providers", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" }, { expiresAt: expiredAt });
    await seedCache("calendar_current", [{ id: "cached-event" }], { expiresAt: expiredAt });
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST, { expiresAt: expiredAt });
    await seedCache("bills_current", {
      bills: [{ id: "cached-bill" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    }, { expiresAt: expiredAt });
    const pending = new Promise(() => {});
    testState.fetchWeather.mockReturnValueOnce(pending);
    testState.fetchCalendar.mockReturnValueOnce(pending);
    testState.fetchTodoistTasks.mockReturnValueOnce(pending);
    testState.refreshBillsMirror.mockReturnValueOnce(pending);

    const res = await requestRefreshResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 64, location: "El Monte, CA" },
      calendar: [{ id: "cached-event" }],
      bills: [{ id: "cached-bill" }],
      activeSnapshot: { snapshot: { id: 42 } },
      providerHealth: {
        currentData: {
          state: "current",
          sources: expect.arrayContaining([
            expect.objectContaining({ key: "weather_current", state: "refreshing" }),
            expect.objectContaining({ key: "calendar_current", state: "refreshing" }),
            expect.objectContaining({ key: "deadlines_current", state: "refreshing" }),
            expect.objectContaining({ key: "bills_current", state: "refreshing" }),
          ]),
        },
        activeSnapshot: { state: "syncing", reason: "background" },
      },
      systemStatus: {
        state: "current",
      },
      refresh: {
        mode: "manual",
        scheduled: expect.arrayContaining([
          expect.objectContaining({ key: "weather_current", reason: "ttl_due" }),
          expect.objectContaining({ key: "bills_current", reason: "ttl_due" }),
          expect.objectContaining({ key: "active_snapshot", reason: "manual_retry" }),
        ]),
      },
    });
  });

  it("degrades one failed provider without failing the current response", async () => {
    testState.fetchWeather.mockRejectedValueOnce(new Error("weather down"));
    testState.fetchCalendar.mockResolvedValueOnce([{ id: "event-ok" }]);
    testState.fetchTodoistTasks.mockResolvedValueOnce([]);

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.weather).toBeNull();
    expect(res.body.calendar).toEqual([
      expect.objectContaining({
        id: "event-ok",
        hasUpcomingReminder: false,
        upcomingReminderCount: 0,
        nextReminderAt: null,
      }),
    ]);
    expect(res.body.providerHealth.currentData.state).toBe("unavailable");
    expect(res.body.providerHealth.currentData.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weather_current",
          state: "unavailable",
          errorMessage: "weather down",
        }),
        expect.objectContaining({
          key: "calendar_current",
          state: "current",
        }),
      ]),
    );
  });

  it("returns a fallback within the deadline instead of hanging when a cold-cache provider stalls (P1-6)", async () => {
    process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS = "20";
    // Cold cache (no seedCache) + a weather provider fetch that never resolves.
    testState.fetchWeather.mockReset().mockReturnValueOnce(new Promise(() => {}));

    const { status, body } = await getCurrentResponse();

    expect(status).toBe(200);
    // The stalled provider must fall back (the aggregated current-data source
    // goes unavailable) rather than blocking the entire /current response on the
    // slowest external call.
    expect(body.systemStatus.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "currentData",
          state: expect.stringMatching(/unavailable|degraded/),
        }),
      ]),
    );
  }, 3000);
});

describe("POST /api/dashboard/current/sync", () => {
  beforeEach(async () => {
    delete process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS;
    testState.db.current = await createMigratedDb();
    testState.fetchWeather.mockReset().mockResolvedValue({ temp: 80, summary: "Synced" });
    testState.fetchCalendar.mockReset().mockResolvedValue([{ id: "synced-event" }]);
    testState.fetchTodoistTasks.mockReset().mockResolvedValue([]);
    testState.fetchTodoistDueTaskIdSet.mockReset().mockResolvedValue(new Set());
    testState.getTodoistSyncHealth.mockReset().mockResolvedValue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-04T12:00:00.000Z",
      lastError: null,
      syncStartedAt: null,
      ageMs: 30_000,
    });
    testState.hydrateRecurringTombstones.mockReset().mockResolvedValue([]);
    testState.refreshBillsMirror.mockReset().mockResolvedValue({
      bills: [{ id: "synced-bill" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    testState.readBillsMirrorCurrent.mockReset().mockResolvedValue({
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    testState.consumeDueBillsMirrorRefresh.mockReset().mockResolvedValue(false);
    testState.clearPendingBillsMirrorRefresh.mockReset().mockResolvedValue(undefined);
    testState.scheduleBillsMirrorRefresh.mockReset().mockResolvedValue({ pendingRefreshAt: "2026-05-04T12:00:00.000Z" });
    testState.getActiveSnapshotView.mockReset().mockResolvedValue({ snapshot: { id: 41 } });
    testState.syncActiveSnapshot.mockReset().mockResolvedValue({ snapshot: { id: 99 } });
  });

  afterEach(async () => {
    clearCurrentDashboardRefreshState();
    await testState.db.current?.close?.();
    testState.db.current = null as unknown as Client;
  });

  it("force refreshes current rows and the active snapshot", async () => {
    await seedCache("weather_current", { temp: 60, location: "Old" });
    await seedCache("calendar_current", [{ id: "old-event" }]);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await syncResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 80, summary: "Synced", location: "El Monte, CA" },
      calendar: [{ id: "synced-event" }],
      bills: [{ id: "synced-bill" }],
      activeSnapshot: { snapshot: { id: 99 } },
      providerHealth: {
        currentData: { state: "current" },
      },
    });
    expect(testState.fetchWeather).toHaveBeenCalledTimes(1);
    expect(testState.fetchCalendar).toHaveBeenCalledTimes(1);
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
      actualBudgetUrl: "https://actual.example.test",
      force: true,
      refreshLocalActual: true,
    }));
    expect(testState.syncActiveSnapshot).toHaveBeenCalledWith("u1");
  });
});

describe("markRowsRefreshing -> markCacheRowRefreshFailed failureCount carry (P3-42)", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null as unknown as Client;
  });

  it("escalates the returned failureCount instead of resetting to 1 across the refreshing transition", async () => {
    const failedAt = "2026-05-04T11:40:00.000Z";
    // Prior degraded row that has already failed twice.
    await testState.db.current.execute({
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at, status,
               last_refresh_failed_at, last_refresh_error, refresh_failure_count, updated_at)
            VALUES (?, 'weather_current', ?, ?, ?, 'degraded', ?, ?, 2, ?)`,
      args: [
        "u1",
        JSON.stringify({ temp: 64, location: "El Monte, CA" }),
        failedAt,
        "2026-05-04T12:40:00.000Z",
        failedAt,
        "weather down",
        failedAt,
      ],
    });

    const loaded = await testState.db.current.execute({
      sql: `SELECT user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
                   refresh_started_at, last_refresh_failed_at, last_refresh_error, refresh_failure_count
            FROM ea_current_data_cache WHERE user_id = 'u1' AND cache_key = 'weather_current'`,
    });
    const rows = { weather_current: loaded.rows[0] };

    const now = new Date("2026-05-04T12:00:00.000Z");
    // Transition the row to "refreshing" (this is what the hot path hands to the
    // background refresh as existingRow).
    const refreshingRows = await markRowsRefreshing("u1", rows, ["weather_current"], {
      dbClient: testState.db.current,
      now,
    });

    // The in-memory refreshing row must still carry the prior failure count, so a
    // subsequent failure escalates rather than resetting to 1.
    const failed = await markCacheRowRefreshFailed("u1", "weather_current", new Error("weather down again"), {
      dbClient: testState.db.current,
      now,
      existingRow: refreshingRows.weather_current,
    });

    expect(failed.refresh_failure_count).toBe(3);

    // Persistence must agree with the returned object.
    const persisted = await testState.db.current.execute({
      sql: `SELECT refresh_failure_count FROM ea_current_data_cache
            WHERE user_id = 'u1' AND cache_key = 'weather_current'`,
    });
    expect(Number(persisted.rows[0]!.refresh_failure_count)).toBe(3);
  });
});
