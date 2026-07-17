import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

const testState = vi.hoisted(() => ({
  db: { current: null },
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
    execute: (...args) => testState.db.current.execute(...args),
    executeMultiple: (...args) => testState.db.current.executeMultiple(...args),
    batch: (...args) => testState.db.current.batch(...args),
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
  filterCompletedTodoistTasks: (...args) => testState.filterCompletedTodoistTasks(...args),
  computeDeadlineStats: vi.fn((items) => ({ total: items.length })),
}));
vi.mock("../platform/weather.ts", () => ({
  fetchWeather: (...args) => testState.fetchWeather(...args),
}));
vi.mock("../calendar/calendar.js", () => ({
  fetchCalendar: (...args) => testState.fetchCalendar(...args),
}));
vi.mock("../tasks/todoist.ts", () => ({
  fetchTodoistDueTaskIdSet: (...args) => testState.fetchTodoistDueTaskIdSet(...args),
  fetchTodoistTasks: (...args) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksAll: (...args) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksRange: (...args) => testState.fetchTodoistTasks(...args),
  getTodoistSyncHealth: (...args) => testState.getTodoistSyncHealth(...args),
}));
vi.mock("../tasks/tombstones.ts", () => ({
  hydrateRecurringTombstones: (...args) => testState.hydrateRecurringTombstones(...args),
}));
vi.mock("../bills/bills-service.ts", () => ({
  readBillsMirrorCurrent: (...args) => testState.readBillsMirrorCurrent(...args),
  refreshBillsMirror: (...args) => testState.refreshBillsMirror(...args),
  getBillsMirrorState: (...args) => testState.getBillsMirrorState(...args),
  isBillsMirrorMaintenanceDue: (health, { now = new Date() } = {}) => {
    if (!health || health.configured !== true) return false;
    if (health.pendingRefreshAt || health.refreshStartedAt) return false;
    if (health.state !== "current" && health.state !== "degraded") return false;
    const lastSuccess = new Date(health.lastSuccessAt || "").getTime();
    return Number.isFinite(lastSuccess) && now.getTime() - lastSuccess >= 15 * 60 * 1000;
  },
  consumeDueBillsMirrorRefresh: (...args) => testState.consumeDueBillsMirrorRefresh(...args),
  clearPendingBillsMirrorRefresh: (...args) => testState.clearPendingBillsMirrorRefresh(...args),
  scheduleBillsMirrorRefresh: (...args) => testState.scheduleBillsMirrorRefresh(...args),
  shouldScheduleImmediateBillsRefresh: (health, now) => {
    if (health?.state !== "needs_sync") return false;
    const pendingAt = health?.pendingRefreshAt ? new Date(health.pendingRefreshAt).getTime() : null;
    return pendingAt === null || pendingAt <= new Date(now ?? Date.now()).getTime();
  },
}));
vi.mock("../snapshots/snapshot-service.js", () => ({
  getActiveSnapshotView: (...args) => testState.getActiveSnapshotView(...args),
  syncActiveSnapshot: (...args) => testState.syncActiveSnapshot(...args),
}));

process.env.EA_USER_ID = "u1";

const EMPTY_DEADLINES_FOR_TEST = {
  upcoming: [],
  stats: null,
};

const {
  __resetCurrentDashboardRefreshStateForTests,
  __waitForCurrentDashboardRefreshesForTests,
  __currentDashboardInternalsForTests,
  applyDeadlineCurrentStatus,
  getCurrentDashboard,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} = await import("./current-service.js");
const {
  subscribeCurrentDashboardEvents,
} = await import("./current-events.js");

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

async function seedAccount({ id, email, needsReauth = false }) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, needs_reauth)
          VALUES (?, 'u1', 'gmail', ?, ?, ?)`,
    args: [id, email, email, needsReauth ? 1 : 0],
  });
}

async function seedCache(cacheKey, payload, { fetchedAt, expiresAt } = {}) {
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

async function getHealthResponse() {
  return {
    status: 200,
    body: await getDashboardSystemHealth("u1", { dbClient: testState.db.current }),
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
    testState.filterCompletedTodoistTasks.mockReset().mockImplementation((tasks, completedIds) => (
      (tasks || []).filter((task) => !completedIds?.has(task.id) && !completedIds?.has(String(task.id)))
    ));
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
    testState.clearPendingBillsMirrorRefresh.mockReset().mockResolvedValue();
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
    __resetCurrentDashboardRefreshStateForTests();
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("attaches a contentKey that stays stable across polls returning unchanged data", async () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 300_000).toISOString();
    await seedCache("weather_current", { temp: 72 }, { expiresAt });
    await seedCache("calendar_current", [], { expiresAt });
    await seedCache("deadlines_current", { upcoming: [], stats: { total: 0 } }, { expiresAt });
    await seedCache("bills_current", {
      bills: [], allSchedules: [], payeeMap: {}, actualConfigured: false, actualBudgetUrl: null,
    }, { expiresAt });

    const first = await getCurrentDashboard("u1", { dbClient: testState.db.current, now });
    const second = await getCurrentDashboard("u1", { dbClient: testState.db.current, now });

    // The content key is a real fingerprint, decoupled from the per-response wall clock.
    expect(first.contentKey).toBeTruthy();
    expect(first.contentKey).not.toBe(first.fetchedAt);
    // Two polls over identical data must produce the same key so the client dedup fires.
    expect(second.contentKey).toBe(first.contentKey);
  });

  it("returns fresh cached current rows without fetching providers or briefing JSON", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", [{ id: "event-1", title: "Focus" }]);
    await seedCache("deadlines_current", {
      upcoming: [{ id: "deadline-1", title: "Submit form" }],
      stats: { total: 1 },
    });
    await seedCache("bills_current", {
      bills: [{ id: "bill-1", payee: "Power" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 71, location: "El Monte, CA" },
      calendar: [{ id: "event-1", title: "Focus" }],
      bills: [{ id: "bill-1", payee: "Power" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      activeSnapshot: { snapshot: { id: 42 } },
      providerHealth: {
        currentData: {
          state: "current",
        },
        todoist: {
          state: "current",
          configured: true,
        },
      },
      systemStatus: {
        state: "current",
        sources: expect.arrayContaining([
          expect.objectContaining({ key: "currentData", state: "current" }),
          expect.objectContaining({ key: "todoist", state: "current" }),
          expect.objectContaining({ key: "bills", state: "current" }),
        ]),
      },
    });
    expect(res.body.deadlines).toMatchObject({
      upcoming: [{ id: "deadline-1", title: "Submit form" }],
      stats: { total: 1 },
    });
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
    expect(testState.readBillsMirrorCurrent).not.toHaveBeenCalled();
    expect(testState.getActiveSnapshotView).toHaveBeenCalledWith("u1");
    expect(testState.getTodoistSyncHealth).toHaveBeenCalledWith("u1");
  });

  it("hydrates reminder indicators onto fresh cached dashboard items", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", [
      {
        id: "event-1",
        title: "Focus",
        startMs: new Date("2099-05-10T17:00:00.000Z").getTime(),
      },
    ]);
    await seedCache("deadlines_current", {
      upcoming: [{ id: "todo-1", title: "Submit form" }],
      stats: { total: 1 },
    });
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    await testState.db.current.batch([
      {
        sql: `INSERT INTO ea_reminders
                (id, user_id, source_type, source_item_id, anchor_kind, anchor_at, offset_minutes, remind_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "event-reminder",
          "u1",
          "calendar_event",
          "event-1",
          "event_start",
          "2099-05-10T17:00:00.000Z",
          -30,
          "2099-05-10T16:30:00.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_reminders
                (id, user_id, source_type, source_item_id, anchor_kind, anchor_at, offset_minutes, remind_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "task-reminder-later",
          "u1",
          "todoist_task",
          "todo-1",
          "todoist_due_datetime",
          "2099-05-10T17:00:00.000Z",
          -10,
          "2099-05-10T16:50:00.000Z",
        ],
      },
      {
        sql: `INSERT INTO ea_reminders
                (id, user_id, source_type, source_item_id, anchor_kind, anchor_at, offset_minutes, remind_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "task-reminder-earliest",
          "u1",
          "todoist_task",
          "todo-1",
          "todoist_due_datetime",
          "2099-05-10T17:00:00.000Z",
          -60,
          "2099-05-10T16:00:00.000Z",
        ],
      },
    ]);

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.calendar[0]).toMatchObject({
      id: "event-1",
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2099-05-10T16:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2099-05-10T16:30:00.000Z",
      },
    });
    expect(res.body.deadlines.upcoming[0]).toMatchObject({
      id: "todo-1",
      hasUpcomingReminder: true,
      upcomingReminderCount: 2,
      nextReminderAt: "2099-05-10T16:00:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 2,
        nextReminderAt: "2099-05-10T16:00:00.000Z",
      },
    });
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
  });

  it("treats malformed deadline cache rows as unusable and returns the domain fallback", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", { sections: [{ id: "old" }] });
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.deadlines).toEqual(EMPTY_DEADLINES_FOR_TEST);
    expect(res.body.providerHealth.currentData.state).toBe("unavailable");
    expect(res.body.refresh.scheduled).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "deadlines_current", reason: "no_usable_payload" }),
    ]));
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: false });
  });

  it("schedules a quiet Bills mirror maintenance refresh when the mirror success is old", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [{ id: "cached-bill", payee: "Power" }],
      allSchedules: [{ id: "cached-bill", payee: "Power" }],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-04T11:40:00.000Z",
      },
    });
    testState.getBillsMirrorState.mockResolvedValueOnce({
      syncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-04T11:40:00.000Z",
        pendingRefreshAt: null,
      },
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.refreshBillsMirror.mockResolvedValueOnce({
      bills: [{ id: "new-bill", payee: "Water" }],
      allSchedules: [{ id: "new-bill", payee: "Water" }],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-04T12:01:00.000Z",
      },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeCurrentDashboardEvents("u1", listener);

    try {
      const res = await getCurrentResponse();

      expect(res.status).toBe(200);
      expect(res.body.bills).toEqual([{ id: "cached-bill", payee: "Power" }]);
      expect(res.body.systemStatus.state).toBe("current");
      expect(res.body.systemStatus.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "bills", state: "current", severity: "none" }),
        ]),
      );
      expect(res.body.refresh).toMatchObject({
        mode: "passive",
        scheduled: expect.arrayContaining([
          expect.objectContaining({ key: "bills_current", reason: "bills_mirror_maintenance_due" }),
        ]),
      });

      await __waitForCurrentDashboardRefreshesForTests();
      expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
        actualBudgetUrl: "https://actual.example.test",
        force: true,
      }));
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        source: "bills",
        reason: "maintenance_refreshed",
        state: "current",
      }));
    } finally {
      unsubscribe();
    }
  });

  it("backs off passive Bills refresh after a recent Actual provider failure", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);

    const failedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await testState.db.current.execute({
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at, status,
               last_refresh_failed_at, last_refresh_error, refresh_failure_count, updated_at)
            VALUES (?, 'bills_current', ?, ?, ?, 'degraded', ?, ?, 3, ?)`,
      args: [
        "u1",
        JSON.stringify({
          bills: [{ id: "cached-bill", payee: "Power" }],
          allSchedules: [{ id: "cached-bill", payee: "Power" }],
          payeeMap: {},
          actualConfigured: true,
          actualBudgetUrl: "https://actual.example.test",
          billsSyncHealth: {
            state: "degraded",
            configured: true,
            lastSuccessAt: "2026-05-04T11:40:00.000Z",
            lastAttemptAt: failedAt,
            lastError: "Actual worker exited",
          },
        }),
        "2026-05-04T11:40:00.000Z",
        "2026-05-04T12:40:00.000Z",
        failedAt,
        "Actual worker exited",
        failedAt,
      ],
    });
    testState.getBillsMirrorState.mockResolvedValueOnce({
      syncHealth: {
        state: "degraded",
        configured: true,
        lastSuccessAt: "2026-05-04T11:40:00.000Z",
        lastAttemptAt: failedAt,
        lastError: "Actual worker exited",
        pendingRefreshAt: null,
      },
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.bills).toEqual([{ id: "cached-bill", payee: "Power" }]);
    expect(res.body.refresh).toMatchObject({
      mode: "passive",
      skipped: expect.arrayContaining([
        expect.objectContaining({ key: "bills_current", reason: "provider_backoff" }),
      ]),
    });
    expect(res.body.refresh.scheduled).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ key: "bills_current" }),
    ]));

    await __waitForCurrentDashboardRefreshesForTests();
    expect(testState.refreshBillsMirror).not.toHaveBeenCalled();
  });

  it("rolls Todoist needs_sync into system status and schedules deadlines refresh", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.getTodoistSyncHealth.mockResolvedValueOnce({
      state: "needs_sync",
      severity: "warning",
      configured: true,
      lastSuccessAt: "2026-05-04T12:00:00.000Z",
      lastError: null,
      syncStartedAt: null,
      ageMs: 30_000,
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.systemStatus.state).toBe("needs_sync");
    expect(res.body.systemStatus.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "currentData", state: "current", severity: "none" }),
      expect.objectContaining({ key: "todoist", state: "needs_sync", severity: "warning" }),
      expect.objectContaining({ key: "bills", state: "current", severity: "none" }),
    ]));
    expect(res.body.refresh).toMatchObject({
      mode: "passive",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "deadlines_current", reason: "needs_sync" }),
      ]),
    });
  });

  it("manual refresh skips fresh stable sources while reconciling Todoist deadlines and Bills ground truth", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await requestRefreshResponse();

    expect(res.status).toBe(200);
    expect(res.body.refresh).toMatchObject({
      mode: "manual",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "deadlines_current", reason: "manual_todoist_sync" }),
        expect.objectContaining({ key: "bills_current", reason: "manual_bills_sync" }),
        expect.objectContaining({ key: "active_snapshot", reason: "manual_retry" }),
      ]),
      skipped: expect.arrayContaining([
        expect.objectContaining({ key: "weather_current", reason: "fresh" }),
        expect.objectContaining({ key: "calendar_current", reason: "fresh" }),
      ]),
    });
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    await __waitForCurrentDashboardRefreshesForTests();
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.fetchTodoistDueTaskIdSet).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
      actualBudgetUrl: "https://actual.example.test",
      force: true,
      refreshLocalActual: true,
    }));
  });

  it("publishes Bills refresh completion even when manual sync returns the same visible payload", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [{ id: "bill-1", payee: "Water" }],
      allSchedules: [{ id: "bill-1", payee: "Water" }],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    testState.refreshBillsMirror.mockResolvedValueOnce({
      bills: [{ id: "bill-1", payee: "Water" }],
      allSchedules: [{ id: "bill-1", payee: "Water" }],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeCurrentDashboardEvents("u1", listener);

    try {
      const res = await requestRefreshResponse();

      expect(res.status).toBe(200);
      await __waitForCurrentDashboardRefreshesForTests();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        source: "bills",
        reason: "changed",
        state: "current",
      }));
    } finally {
      unsubscribe();
    }
  });

  it("manual refresh forces a pending Bills mirror refresh even when current cache is fresh", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [{ id: "cached-bill" }],
      allSchedules: [{ id: "cached-bill" }],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: {
        state: "needs_sync",
        configured: true,
        pendingRefreshAt: "2026-05-04T12:01:00.000Z",
      },
    });
    testState.getBillsMirrorState.mockResolvedValueOnce({
      syncHealth: {
        state: "needs_sync",
        configured: true,
        pendingRefreshAt: "2026-05-04T12:01:00.000Z",
      },
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await requestRefreshResponse();

    expect(res.status).toBe(200);
    expect(res.body.refresh).toMatchObject({
      mode: "manual",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "bills_current", reason: "pending_bills_mirror" }),
      ]),
      skipped: expect.not.arrayContaining([
        expect.objectContaining({ key: "bills_current" }),
      ]),
    });

    await __waitForCurrentDashboardRefreshesForTests();
    expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
      actualBudgetUrl: "https://actual.example.test",
      force: true,
      refreshLocalActual: true,
    }));
    expect(testState.clearPendingBillsMirrorRefresh).toHaveBeenCalledWith("u1", expect.objectContaining({
      force: true,
    }));
  });

  it("refreshes deadlines when the Todoist mirror is newer than the deadlines cache", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST, {
      fetchedAt: "2026-05-05T00:22:00.000Z",
      expiresAt: "2026-05-05T00:37:00.000Z",
    });
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.getTodoistSyncHealth.mockResolvedValueOnce({
      state: "current",
      severity: "none",
      configured: true,
      lastSuccessAt: "2026-05-05T00:35:00.000Z",
      lastError: null,
      syncStartedAt: null,
      ageMs: 30_000,
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.providerHealth.currentData.state).toBe("current");
    expect(res.body.refresh).toMatchObject({
      mode: "passive",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "deadlines_current", reason: "needs_sync" }),
      ]),
    });
    await __waitForCurrentDashboardRefreshesForTests();
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: false });
  });

  it("returns authenticated dashboard health without treating normal TTL expiry as unhealthy", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" }, { expiresAt: expiredAt });
    await seedCache("calendar_current", [], { expiresAt: expiredAt });
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST, { expiresAt: expiredAt });
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    }, { expiresAt: expiredAt });
    testState.getTodoistSyncHealth.mockResolvedValueOnce({
      state: "syncing",
      configured: true,
      lastSuccessAt: "2026-05-04T12:00:00.000Z",
      lastError: null,
      syncStartedAt: "2026-05-04T12:04:00.000Z",
      ageMs: 240_000,
    });

    const res = await getHealthResponse();

    expect(res.status).toBe(200);
    expect(res.body.providerHealth).toMatchObject({
      currentData: {
        state: "current",
        sources: expect.arrayContaining([
          expect.objectContaining({ key: "weather_current", state: "current", severity: "none" }),
        ]),
      },
      todoist: { state: "syncing", configured: true },
    });
    expect(res.body.systemStatus.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "currentData",
        state: "current",
        severity: "none",
        lastSuccessAt: expect.any(String),
        message: expect.stringMatching(/usable/i),
      }),
      expect.objectContaining({
        key: "todoist",
        state: "syncing",
        severity: "info",
        lastSuccessAt: "2026-05-04T12:00:00.000Z",
        message: expect.stringMatching(/sync/i),
      }),
      expect.objectContaining({ key: "bills", state: "current" }),
    ]));
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
  });

  it("reports Todoist health check failures as unavailable, not unconfigured", async () => {
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.getTodoistSyncHealth.mockRejectedValueOnce(new Error("Todoist OAuth refresh failed"));

    const res = await getHealthResponse();

    expect(res.status).toBe(200);
    expect(res.body.providerHealth.todoist).toMatchObject({
      state: "unavailable",
      configured: null,
      lastError: "Todoist OAuth refresh failed",
    });
    expect(res.body.systemStatus.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "currentData", state: "current" }),
      expect.objectContaining({
        key: "todoist",
        state: "unavailable",
        message: "Todoist mirror is unavailable.",
      }),
      expect.objectContaining({ key: "bills", state: "current" }),
    ]));
  });

  it("surfaces flagged accounts/Todoist as loud reauth sources in dashboard system health (REL-01)", async () => {
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    await seedAccount({ id: "gmail-good", email: "good@example.com", needsReauth: false });
    await seedAccount({ id: "gmail-revoked", email: "revoked@example.com", needsReauth: true });
    await testState.db.current.execute({
      sql: "INSERT INTO ea_settings (user_id, todoist_needs_reauth) VALUES ('u1', 1)",
    });

    const res = await getHealthResponse();

    expect(res.status).toBe(200);
    expect(res.body.providerHealth.reauth).toEqual({
      accounts: [{ id: "gmail-revoked", email: "revoked@example.com", type: "gmail" }],
      todoist: true,
    });
    expect(res.body.systemStatus.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "reauth:gmail-revoked",
        label: "Gmail (revoked@example.com)",
        state: "needs_reauth",
        severity: "error",
      }),
      expect.objectContaining({
        key: "reauth:todoist",
        state: "needs_reauth",
        severity: "error",
      }),
    ]));
    expect(res.body.systemStatus.state).toBe("unavailable");
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

  it("refreshes missing current rows per domain and stores them for later reads", async () => {
    testState.fetchWeather.mockResolvedValueOnce({ temp: 72, summary: "Clear" });
    testState.fetchCalendar.mockResolvedValueOnce([{ id: "event-2", title: "Planning" }]);
    testState.fetchTodoistTasks.mockResolvedValueOnce([{ id: "todoist-1", source: "todoist" }]);
    testState.readBillsMirrorCurrent.mockResolvedValueOnce({
      bills: [{ id: "bill-2", payee: "Rent" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee_1: "Rent" },
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 72, summary: "Clear", location: "El Monte, CA" },
      calendar: [{ id: "event-2", title: "Planning" }],
      deadlines: {
        upcoming: [{ id: "todoist-1" }],
        stats: { total: 1 },
      },
      bills: [{ id: "bill-2", payee: "Rent" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee_1: "Rent" },
      providerHealth: {
        currentData: {
          state: "current",
        },
      },
    });
    expect(testState.fetchWeather).toHaveBeenCalledWith(34.1442, -117.9981);
    expect(testState.fetchCalendar).toHaveBeenCalledWith([
      { id: "gmail-a", type: "gmail", calendar_enabled: true, label: "Work" },
    ]);
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: false });
    expect(testState.readBillsMirrorCurrent).toHaveBeenCalledWith("u1", expect.objectContaining({
      dbClient: expect.any(Object),
    }));

    testState.fetchWeather.mockReset().mockRejectedValue(new Error("weather should stay cached"));
    testState.fetchCalendar.mockReset().mockRejectedValue(new Error("calendar should stay cached"));
    testState.fetchTodoistTasks.mockReset().mockRejectedValue(new Error("deadlines should stay cached"));
    testState.readBillsMirrorCurrent.mockReset().mockRejectedValue(new Error("bills should stay cached"));

    const cached = await getCurrentResponse();
    expect(cached.status).toBe(200);
    expect(cached.body).toMatchObject({
      weather: { temp: 72, summary: "Clear", location: "El Monte, CA" },
      calendar: [{ id: "event-2", title: "Planning" }],
      deadlines: {
        upcoming: [{ id: "todoist-1" }],
        stats: { total: 1 },
      },
      bills: [{ id: "bill-2", payee: "Rent" }],
      providerHealth: {
        currentData: { state: "current" },
      },
    });
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
    expect(testState.readBillsMirrorCurrent).not.toHaveBeenCalled();
  });

  it("hydrates current completed Todoist rows from completed-task snapshots", async () => {
    testState.fetchTodoistTasks.mockResolvedValueOnce([
      { id: "todo-open", title: "Open task", due_date: "2026-05-04", source: "todoist", status: "incomplete" },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValueOnce(new Set(["todo-open", "todo-done"]));
    testState.hydrateRecurringTombstones.mockResolvedValueOnce([
      { id: "todo-done", title: "Completed task", due_date: "2026-05-04", source: "todoist", status: "complete", _tombstone: true },
    ]);

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-open", "todo-done"]),
      { viewBoundary: "today" },
    );
    expect(res.body.deadlines.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-done"]);
    expect(res.body.deadlines.upcoming[0]).toMatchObject({
      source: "todoist",
      sourceLabel: "Todoist",
      color: "#e44332",
      sourceColor: "#e44332",
    });
    expect(res.body.deadlines.stats).toEqual({ total: 2 });
  });

  it("writes successful deadline status mutations through to current dashboard cache", async () => {
    const eventPromise = new Promise((resolve) => {
      const unsubscribe = subscribeCurrentDashboardEvents("u1", (event) => {
        unsubscribe();
        resolve(event);
      });
    });
    await seedCache("deadlines_current", {
      upcoming: [
        { id: "todo-1", title: "Buy stamps", status: "incomplete" },
      ],
      stats: { total: 1 },
    });

    const result = await applyDeadlineCurrentStatus("u1", "todo-1", "complete", {
      dbClient: testState.db.current,
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(result.updated).toBe(true);
    const dashboard = await getCurrentResponse();
    expect(dashboard.body.deadlines).toMatchObject({
      upcoming: [
        expect.objectContaining({
          id: "todo-1",
          status: "complete",
        }),
      ],
      stats: { total: 1 },
    });
    expect(dashboard.body.providerHealth.currentData).toMatchObject({
      state: "current",
      sources: expect.arrayContaining([
        expect.objectContaining({ key: "deadlines_current", state: "current" }),
      ]),
    });
    await expect(eventPromise).resolves.toMatchObject({
      source: "deadlines",
      reason: "task_status_updated",
      details: { taskId: "todo-1", status: "complete" },
    });
  });

  it("returns stale cached rows immediately while refreshing them in the background", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" }, { expiresAt: expiredAt });
    await seedCache("calendar_current", [{ id: "old-event" }], { expiresAt: expiredAt });
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST, { expiresAt: expiredAt });
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    }, { expiresAt: expiredAt });

    let resolveWeather;
    let markWeatherStarted;
    const weatherStarted = new Promise((resolve) => {
      markWeatherStarted = resolve;
    });
    const weatherRefresh = new Promise((resolve) => {
      resolveWeather = resolve;
    });
    testState.fetchWeather.mockImplementationOnce(() => {
      markWeatherStarted();
      return weatherRefresh;
    });

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.weather).toEqual({ temp: 64, location: "El Monte, CA" });
    expect(res.body.providerHealth.currentData.state).toBe("current");
    expect(res.body.providerHealth.currentData.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weather_current",
          state: "refreshing",
          severity: "info",
        }),
      ]),
    );
    expect(res.body.systemStatus.state).toBe("current");
    expect(res.body.refresh).toMatchObject({
      mode: "passive",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "weather_current", reason: "ttl_due" }),
      ]),
    });
    await weatherStarted;
    expect(testState.fetchWeather).toHaveBeenCalledTimes(1);

    resolveWeather({ temp: 75, summary: "Refreshed" });
    await __waitForCurrentDashboardRefreshesForTests();
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

  it("preserves cached payload when a background refresh fails", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const fetchedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" }, { fetchedAt, expiresAt: expiredAt });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });
    testState.fetchWeather.mockRejectedValueOnce(new Error("weather down"));

    const res = await getCurrentResponse();
    expect(res.status).toBe(200);
    expect(res.body.weather).toEqual({ temp: 64, location: "El Monte, CA" });
    expect(res.body.providerHealth.currentData.state).toBe("current");

    await __waitForCurrentDashboardRefreshesForTests();

    const health = await getHealthResponse();
    expect(health.body.providerHealth.currentData).toMatchObject({
      state: "current",
      sources: expect.arrayContaining([
        expect.objectContaining({
          key: "weather_current",
          state: "degraded",
          severity: "none",
          errorMessage: "weather down",
          failureCount: 1,
        }),
      ]),
    });
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
    testState.clearPendingBillsMirrorRefresh.mockReset().mockResolvedValue();
    testState.scheduleBillsMirrorRefresh.mockReset().mockResolvedValue({ pendingRefreshAt: "2026-05-04T12:00:00.000Z" });
    testState.getActiveSnapshotView.mockReset().mockResolvedValue({ snapshot: { id: 41 } });
    testState.syncActiveSnapshot.mockReset().mockResolvedValue({ snapshot: { id: 99 } });
  });

  afterEach(async () => {
    __resetCurrentDashboardRefreshStateForTests();
    await testState.db.current?.close?.();
    testState.db.current = null;
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

  it("bounds active snapshot sync and falls back to the active snapshot view", async () => {
    process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS = "20";
    testState.syncActiveSnapshot.mockReturnValueOnce(new Promise(() => {}));
    testState.getActiveSnapshotView.mockResolvedValueOnce({ snapshot: { id: 41 } });

    const startedAt = Date.now();
    const res = await syncResponse();

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(res.status).toBe(200);
    expect(res.body.activeSnapshot).toEqual({ snapshot: { id: 41 } });
    expect(res.body.providerHealth.activeSnapshot).toMatchObject({
      state: "stale",
      reason: "timeout",
    });
  });
});

describe("markRowsRefreshing -> markCacheRowRefreshFailed failureCount carry (P3-42)", () => {
  const { markRowsRefreshing, markCacheRowRefreshFailed } = __currentDashboardInternalsForTests;

  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
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
    expect(Number(persisted.rows[0].refresh_failure_count)).toBe(3);
  });
});
