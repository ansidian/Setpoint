import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  db: { current: null },
  fetchWeather: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchCTMDeadlines: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  readBillsMirrorCurrent: vi.fn(),
  refreshBillsMirror: vi.fn(),
  getBillsMirrorState: vi.fn(),
  consumeDueBillsMirrorRefresh: vi.fn(),
  clearPendingBillsMirrorRefresh: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
  getActiveSnapshotView: vi.fn(),
  syncActiveSnapshot: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    executeMultiple: (...args) => testState.db.current.executeMultiple(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("../briefing/config-service.js", () => ({
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
vi.mock("../briefing/deadline-helpers.js", () => ({
  loadCompletedTaskIds: vi.fn(async () => new Set()),
  separateDeadlines: vi.fn((ctm, todoist) => ({ ctm, todoist })),
  computeDeadlineStats: vi.fn((items) => ({ total: items.length })),
}));
vi.mock("../briefing/weather.js", () => ({
  fetchWeather: (...args) => testState.fetchWeather(...args),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: (...args) => testState.fetchCalendar(...args),
}));
vi.mock("../briefing/ctm.js", () => ({
  fetchCTMDeadlines: (...args) => testState.fetchCTMDeadlines(...args),
}));
vi.mock("../briefing/todoist.js", () => ({
  fetchTodoistDueTaskIdSet: (...args) => testState.fetchTodoistDueTaskIdSet(...args),
  fetchTodoistTasks: (...args) => testState.fetchTodoistTasks(...args),
  getTodoistSyncHealth: (...args) => testState.getTodoistSyncHealth(...args),
}));
vi.mock("../briefing/tombstones.js", () => ({
  hydrateRecurringTombstones: (...args) => testState.hydrateRecurringTombstones(...args),
}));
vi.mock("../briefing/bills-service.js", () => ({
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
}));
vi.mock("../briefing/snapshot-service.js", () => ({
  getActiveSnapshotView: (...args) => testState.getActiveSnapshotView(...args),
  syncActiveSnapshot: (...args) => testState.syncActiveSnapshot(...args),
}));

process.env.EA_USER_ID = "u1";

const EMPTY_DEADLINES_FOR_TEST = {
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
};

const { default: router } = await import("./dashboard.js");
const {
  __resetCurrentDashboardRefreshStateForTests,
  applyDeadlineCurrentStatus,
} = await import("../dashboard/current-service.js");
const {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} = await import("../dashboard/current-events.js");

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use("/api/dashboard", router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function hashSessionToken(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

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
  `);
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken("cookie-session"), Date.now() + 60_000],
  });
  return db;
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

describe("GET /api/dashboard/current/events", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    __resetCurrentDashboardEventsForTests();
  });

  afterEach(async () => {
    __resetCurrentDashboardEventsForTests();
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a cookie session before opening the current-dashboard event stream", async () => {
    const res = await request(makeApp()).get("/api/dashboard/current/events");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("opens an authenticated SSE stream with a connected event", async () => {
    const server = await listen(makeApp());
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/current/events`, {
      headers: { cookie: "ea_session=cookie-session" },
    });

    try {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("cache-control")).toContain("no-cache");

      const reader = response.body.getReader();
      const { value } = await reader.read();
      const chunk = new TextDecoder().decode(value);

      expect(chunk).toContain("retry: 5000\n");
      expect(chunk).toContain("event: dashboard-current-connected\n");
      expect(chunk).toContain("\"type\":\"dashboard_current_connected\"");
      await reader.cancel();
    } finally {
      await closeServer(server);
    }
  });
});

describe("GET /api/dashboard/current", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    delete process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS;
    testState.fetchWeather.mockReset().mockResolvedValue({ temp: 72 });
    testState.fetchCalendar.mockReset().mockResolvedValue([]);
    testState.fetchCTMDeadlines.mockReset().mockResolvedValue([]);
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

  it("requires a cookie session before loading current dashboard data", async () => {
    const res = await request(makeApp()).get("/api/dashboard/current");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("returns fresh cached current rows without fetching providers or briefing JSON", async () => {
    await seedCache("weather_current", { temp: 71, location: "El Monte, CA" });
    await seedCache("calendar_current", [{ id: "event-1", title: "Focus" }]);
    await seedCache("deadlines_current", {
      ctm: { upcoming: [{ id: "ctm-1" }], stats: { total: 1 } },
      todoist: { upcoming: [], stats: { total: 0 } },
    });
    await seedCache("bills_current", {
      bills: [{ id: "bill-1", payee: "Power" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 71, location: "El Monte, CA" },
      calendar: [{ id: "event-1", title: "Focus" }],
      deadlines: {
        ctm: { upcoming: [{ id: "ctm-1" }], stats: { total: 1 } },
        todoist: { upcoming: [], stats: { total: 0 } },
      },
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
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchCTMDeadlines).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
    expect(testState.readBillsMirrorCurrent).not.toHaveBeenCalled();
    expect(testState.getActiveSnapshotView).toHaveBeenCalledWith("u1");
    expect(testState.getTodoistSyncHealth).toHaveBeenCalledWith("u1");
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
      const res = await request(makeApp())
        .get("/api/dashboard/current")
        .set("Cookie", ["ea_session=cookie-session"]);

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

      await new Promise((resolve) => setTimeout(resolve, 0));
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

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

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

  it("manual refresh skips fresh non-Bills current-data sources and forces Bills ground truth", async () => {
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

    const res = await request(makeApp())
      .post("/api/dashboard/current/refresh")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.refresh).toMatchObject({
      mode: "manual",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "bills_current", reason: "manual_bills_sync" }),
        expect.objectContaining({ key: "active_snapshot", reason: "manual_retry" }),
      ]),
      skipped: expect.arrayContaining([
        expect.objectContaining({ key: "weather_current", reason: "fresh" }),
        expect.objectContaining({ key: "calendar_current", reason: "fresh" }),
        expect.objectContaining({ key: "deadlines_current", reason: "fresh" }),
      ]),
    });
    expect(testState.fetchWeather).not.toHaveBeenCalled();
    expect(testState.fetchCalendar).not.toHaveBeenCalled();
    expect(testState.fetchTodoistTasks).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
      actualBudgetUrl: "https://actual.example.test",
      force: true,
    }));
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

    const res = await request(makeApp())
      .post("/api/dashboard/current/refresh")
      .set("Cookie", ["ea_session=cookie-session"]);

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

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(testState.refreshBillsMirror).toHaveBeenCalledWith("u1", expect.objectContaining({
      actualBudgetUrl: "https://actual.example.test",
      force: true,
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

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.providerHealth.currentData.state).toBe("current");
    expect(res.body.refresh).toMatchObject({
      mode: "passive",
      scheduled: expect.arrayContaining([
        expect.objectContaining({ key: "deadlines_current", reason: "needs_sync" }),
      ]),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
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

    const res = await request(makeApp())
      .get("/api/dashboard/health")
      .set("Cookie", ["ea_session=cookie-session"]);

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

    const res = await request(makeApp())
      .get("/api/dashboard/health")
      .set("Cookie", ["ea_session=cookie-session"]);

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
    testState.fetchCTMDeadlines.mockReturnValueOnce(pending);
    testState.fetchTodoistTasks.mockReturnValueOnce(pending);
    testState.refreshBillsMirror.mockReturnValueOnce(pending);

    const startedAt = Date.now();
    const res = await request(makeApp())
      .post("/api/dashboard/current/refresh")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 64, location: "El Monte, CA" },
      calendar: [{ id: "cached-event" }],
      bills: [{ id: "cached-bill" }],
      activeSnapshot: { snapshot: { id: 42 } },
      providerHealth: {
        currentData: { state: "current" },
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

    const rows = await testState.db.current.execute({
      sql: `SELECT cache_key, status, refresh_started_at
            FROM ea_current_data_cache
            WHERE user_id = ?
            ORDER BY cache_key`,
      args: ["u1"],
    });
    expect(rows.rows).toEqual([
      expect.objectContaining({ cache_key: "bills_current", status: "refreshing", refresh_started_at: expect.any(String) }),
      expect.objectContaining({ cache_key: "calendar_current", status: "refreshing", refresh_started_at: expect.any(String) }),
      expect.objectContaining({ cache_key: "deadlines_current", status: "refreshing", refresh_started_at: expect.any(String) }),
      expect.objectContaining({ cache_key: "weather_current", status: "refreshing", refresh_started_at: expect.any(String) }),
    ]);
  });

  it("refreshes missing current rows per domain and stores them for later reads", async () => {
    testState.fetchWeather.mockResolvedValueOnce({ temp: 72, summary: "Clear" });
    testState.fetchCalendar.mockResolvedValueOnce([{ id: "event-2", title: "Planning" }]);
    testState.fetchCTMDeadlines.mockResolvedValueOnce([{ id: "ctm-2" }]);
    testState.fetchTodoistTasks.mockResolvedValueOnce([{ id: "todoist-1" }]);
    testState.readBillsMirrorCurrent.mockResolvedValueOnce({
      bills: [{ id: "bill-2", payee: "Rent" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee_1: "Rent" },
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      billsSyncHealth: { state: "current", configured: true },
    });

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 72, summary: "Clear", location: "El Monte, CA" },
      calendar: [{ id: "event-2", title: "Planning" }],
      deadlines: {
        ctm: { upcoming: [{ id: "ctm-2" }], stats: { total: 1 } },
        todoist: { upcoming: [{ id: "todoist-1" }], stats: { total: 1 } },
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
    expect(testState.fetchCTMDeadlines).toHaveBeenCalledTimes(1);
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: false });
    expect(testState.readBillsMirrorCurrent).toHaveBeenCalledWith("u1", expect.objectContaining({
      dbClient: expect.any(Object),
    }));

    const cached = await testState.db.current.execute({
      sql: "SELECT cache_key, payload_json, status, error_message FROM ea_current_data_cache WHERE user_id = ? ORDER BY cache_key",
      args: ["u1"],
    });
    expect(cached.rows.map((row) => row.cache_key)).toEqual([
      "bills_current",
      "calendar_current",
      "deadlines_current",
      "weather_current",
    ]);
    expect(cached.rows.every((row) => row.status === "current" && !row.error_message)).toBe(true);
  });

  it("hydrates current completed Todoist rows from completed-task snapshots", async () => {
    testState.fetchTodoistTasks.mockResolvedValueOnce([
      { id: "todo-open", title: "Open task", due_date: "2026-05-04", source: "todoist", status: "incomplete" },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValueOnce(new Set(["todo-open", "todo-done"]));
    testState.hydrateRecurringTombstones.mockResolvedValueOnce([
      { id: "todo-done", title: "Completed task", due_date: "2026-05-04", source: "todoist", status: "complete", _tombstone: true },
    ]);

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-open", "todo-done"]),
      { viewBoundary: "today" },
    );
    expect(res.body.deadlines.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-done"]);
    expect(res.body.deadlines.todoist.stats).toEqual({ total: 2 });
  });

  it("writes successful deadline status mutations through to current dashboard cache", async () => {
    const eventPromise = new Promise((resolve) => {
      const unsubscribe = subscribeCurrentDashboardEvents("u1", (event) => {
        unsubscribe();
        resolve(event);
      });
    });
    await seedCache("deadlines_current", {
      ctm: {
        upcoming: [
          { id: "ctm-1", title: "Submit essay", status: "incomplete", source: "canvas" },
        ],
        stats: { total: 1 },
      },
      todoist: {
        upcoming: [
          { id: "todo-1", title: "Buy stamps", status: "incomplete", source: "todoist" },
        ],
        stats: { total: 1 },
      },
    });

    const result = await applyDeadlineCurrentStatus("u1", "ctm-1", "complete", {
      dbClient: testState.db.current,
      now: new Date("2026-05-08T12:00:00.000Z"),
      source: "ctm",
    });

    expect(result.updated).toBe(true);
    const cached = await testState.db.current.execute({
      sql: "SELECT payload_json, status, refresh_started_at FROM ea_current_data_cache WHERE user_id = ? AND cache_key = ?",
      args: ["u1", "deadlines_current"],
    });
    const payload = JSON.parse(cached.rows[0].payload_json);
    expect(payload.ctm.upcoming[0]).toMatchObject({
      id: "ctm-1",
      status: "complete",
    });
    expect(payload.todoist.upcoming[0].status).toBe("incomplete");
    expect(payload.ctm.stats).toEqual({ total: 1 });
    expect(cached.rows[0]).toMatchObject({
      status: "current",
      refresh_started_at: null,
    });
    await expect(eventPromise).resolves.toMatchObject({
      source: "deadlines",
      reason: "task_status_updated",
      details: { taskId: "ctm-1", status: "complete" },
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
    const weatherRefresh = new Promise((resolve) => {
      resolveWeather = resolve;
    });
    testState.fetchWeather.mockReturnValueOnce(weatherRefresh);

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

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
    await Promise.resolve();
    expect(testState.fetchWeather).toHaveBeenCalledTimes(1);

    resolveWeather({ temp: 75, summary: "Refreshed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("degrades one failed provider without failing the current response", async () => {
    testState.fetchWeather.mockRejectedValueOnce(new Error("weather down"));
    testState.fetchCalendar.mockResolvedValueOnce([{ id: "event-ok" }]);
    testState.fetchCTMDeadlines.mockResolvedValueOnce([]);
    testState.fetchTodoistTasks.mockResolvedValueOnce([]);

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.weather).toBeNull();
    expect(res.body.calendar).toEqual([{ id: "event-ok" }]);
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

    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(res.status).toBe(200);
    expect(res.body.weather).toEqual({ temp: 64, location: "El Monte, CA" });
    expect(res.body.providerHealth.currentData.state).toBe("current");

    await Promise.resolve();
    const row = await testState.db.current.execute({
      sql: "SELECT payload_json, status, last_refresh_error, refresh_failure_count FROM ea_current_data_cache WHERE user_id = ? AND cache_key = ?",
      args: ["u1", "weather_current"],
    });
    expect(row.rows[0]).toMatchObject({
      payload_json: JSON.stringify({ temp: 64, location: "El Monte, CA" }),
      status: "degraded",
      last_refresh_error: "weather down",
      refresh_failure_count: 1,
    });

    const health = await request(makeApp())
      .get("/api/dashboard/health")
      .set("Cookie", ["ea_session=cookie-session"]);
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
});

describe("POST /api/dashboard/current/sync", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    testState.fetchWeather.mockReset().mockResolvedValue({ temp: 80, summary: "Synced" });
    testState.fetchCalendar.mockReset().mockResolvedValue([{ id: "synced-event" }]);
    testState.fetchCTMDeadlines.mockReset().mockResolvedValue([]);
    testState.fetchTodoistTasks.mockReset().mockResolvedValue([]);
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

    const res = await request(makeApp())
      .post("/api/dashboard/current/sync")
      .set("Cookie", ["ea_session=cookie-session"]);

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
    }));
    expect(testState.syncActiveSnapshot).toHaveBeenCalledWith("u1");
  });

  it("bounds active snapshot sync and falls back to the active snapshot view", async () => {
    process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS = "20";
    testState.syncActiveSnapshot.mockReturnValueOnce(new Promise(() => {}));
    testState.getActiveSnapshotView.mockResolvedValueOnce({ snapshot: { id: 41 } });

    const startedAt = Date.now();
    const res = await request(makeApp())
      .post("/api/dashboard/current/sync")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(res.status).toBe(200);
    expect(res.body.activeSnapshot).toEqual({ snapshot: { id: 41 } });
    expect(res.body.providerHealth.activeSnapshot).toMatchObject({
      state: "stale",
      reason: "timeout",
    });
  });
});
