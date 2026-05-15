import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock deps before importing the route
vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../briefing/config-service.js", () => ({
  loadUserConfig: vi.fn(),
}));
vi.mock("../briefing/deadline-helpers.js", () => ({
  filterCompletedTodoistTasks: vi.fn((tasks, completedIds) => (
    (tasks || []).filter((task) => !completedIds?.has(task.id) && !completedIds?.has(String(task.id)))
  )),
  computeDeadlineStats: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: vi.fn(),
  pacificDayBoundaries: vi.fn((date) => ({ dayStart: date, dayEnd: date })),
  getCalendarSourceGroups: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  formatCalendarRouteError: vi.fn((err) => ({
    status: err.status || 500,
    body: { code: err.code || "calendar_error", message: err.message || "Calendar error" },
  })),
}));
vi.mock("../briefing/calendar-search-mirror.js", () => ({
  deleteCalendarSearchMirrorOccurrence: vi.fn(),
  getCalendarSearchMirrorHealth: vi.fn(),
  listCalendarSearchMirrorOccurrences: vi.fn(),
  markCalendarSearchMirrorDirty: vi.fn(),
  requestCalendarSearchMirrorSync: vi.fn(),
  upsertCalendarSearchMirrorOccurrence: vi.fn(),
}));
vi.mock("../briefing/todoist.js", () => ({
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
}));
vi.mock("../briefing/bills-service.js", () => ({
  isBillsMirrorMaintenanceDue: vi.fn(),
  readBillsMirrorRange: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
}));
vi.mock("../dashboard/current-service.js", () => ({
  applyDeadlineCurrentStatus: vi.fn(),
  requestBillsCurrentMaintenanceRefresh: vi.fn(),
}));
vi.mock("../briefing/tasks-service.js", () => ({
  completeDeadlineOccurrence: vi.fn(),
  createDeadline: vi.fn(),
  deleteDeadline: vi.fn(),
  updateDeadline: vi.fn(),
}));
vi.mock("../briefing/google-places.js", () => ({
  getGooglePlaceDetails: vi.fn(),
  suggestGooglePlaces: vi.fn(),
}));
vi.mock("../briefing/tombstones.js", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../briefing/reminder-service.js", () => ({
  deleteSourceReminders: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn(),
  recomputeUnsentRemindersForSource: vi.fn(),
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }) => `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`,
}));
vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));

const {
  computeDeadlineStats,
  loadCompletedTaskIds,
} = await import("../briefing/deadline-helpers.js");
const { loadUserConfig } = await import("../briefing/config-service.js");
const { fetchCalendar } = await import("../briefing/calendar.js");
const { fetchTodoistDueTaskIdSet, fetchTodoistTasksAll, fetchTodoistTasksRange, getTodoistSyncHealth } = await import("../briefing/todoist.js");
const { isBillsMirrorMaintenanceDue, readBillsMirrorRange, scheduleBillsMirrorRefresh } = await import("../briefing/bills-service.js");
const { requestBillsCurrentMaintenanceRefresh } = await import("../dashboard/current-service.js");
const { hydrateRecurringTombstones } = await import("../briefing/tombstones.js");
const { listUpcomingReminderStatesForSources } = await import("../briefing/reminder-service.js");
const db = (await import("../db/connection.js")).default;
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("GET /api/calendar/range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    loadUserConfig.mockResolvedValue({
      accounts: [
        { id: "a1", type: "gmail", email: "x@y.com", calendar_enabled: 1 },
      ],
      settings: {},
    });
    fetchCalendar.mockResolvedValue([
      { id: "event-1", title: "Test event", startMs: Date.parse("2026-04-20T17:00:00.000Z"), endMs: Date.parse("2026-04-20T18:00:00.000Z"), source: "x@y.com", color: "#abc" },
    ]);
    listUpcomingReminderStatesForSources.mockResolvedValue(new Map());
    fetchTodoistTasksRange.mockResolvedValue([]);
    fetchTodoistDueTaskIdSet.mockResolvedValue(new Set());
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
    readBillsMirrorRange.mockResolvedValue({
      schedules: [],
      recentTransactions: [],
      payeeMap: {},
      syncHealth: { state: "current", configured: true },
    });
    hydrateRecurringTombstones.mockResolvedValue([]);
    loadCompletedTaskIds.mockResolvedValue(new Set());
    computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns 400 when start param missing", async () => {
    const res = await request(makeApp()).get("/api/calendar/range?end=2026-04-25");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/start/i);
  });

  it("returns 400 when end param missing", async () => {
    const res = await request(makeApp()).get("/api/calendar/range?start=2026-04-18");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/end/i);
  });

  it("returns 400 on malformed date", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=not-a-date&end=2026-04-25",
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when end < start", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-25&end=2026-04-18",
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when span > 62 days", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-01-01&end=2026-12-31",
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/62/);
  });

  it("returns events on happy path", async () => {
    listUpcomingReminderStatesForSources.mockResolvedValueOnce(new Map([
      ["calendar_event:event-1:", {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-04-20T16:30:00.000Z",
      }],
    ]));

    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-18&end=2026-04-25",
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(listUpcomingReminderStatesForSources).toHaveBeenCalledWith({
      userId: process.env.EA_USER_ID,
      sources: [{
        sourceType: "calendar_event",
        sourceItemId: "event-1",
        sourceOccurrenceId: null,
      }],
    });
    expect(res.body.events[0]).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-04-20T16:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-04-20T16:30:00.000Z",
      },
    });
    expect(res.body.fetchedAt).toEqual(expect.any(String));
  });

  it("filters to calendar-enabled Gmail accounts", async () => {
    loadUserConfig.mockResolvedValueOnce({
      accounts: [
        { id: "a1", type: "gmail", email: "on@y.com", calendar_enabled: 1 },
        { id: "a2", type: "gmail", email: "off@y.com", calendar_enabled: 0 },
        { id: "a3", type: "icloud", email: "i@y.com" },
      ],
      settings: {},
    });
    await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-18&end=2026-04-25",
    );
    const passed = fetchCalendar.mock.calls[0][0];
    expect(passed).toHaveLength(1);
    expect(passed[0].email).toBe("on@y.com");
  });
});

describe("GET /api/calendar/deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    fetchTodoistTasksAll.mockResolvedValue([
      { id: "todo-open", title: "Open task", due_date: "2026-05-04", source: "todoist", status: "incomplete" },
    ]);
    fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-open"]));
    hydrateRecurringTombstones.mockResolvedValue([
      { id: "todo-done", title: "Completed task", due_date: "2026-05-03", source: "todoist", status: "complete", _tombstone: true },
    ]);
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
    loadCompletedTaskIds.mockResolvedValue(new Set());
    computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
    listUpcomingReminderStatesForSources.mockResolvedValue(new Map());
    db.execute.mockRejectedValue(new Error("latest briefing JSON should not be read"));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("hydrates completed Todoist rows from completed-task snapshots without previous briefing JSON", async () => {
    const res = await request(makeApp()).get("/api/calendar/deadlines");

    expect(res.status).toBe(200);
    expect(fetchTodoistTasksAll).toHaveBeenCalledWith(process.env.EA_USER_ID);
    expect(hydrateRecurringTombstones).toHaveBeenCalledWith(
      process.env.EA_USER_ID,
      new Set(["todo-open"]),
      { viewBoundary: "today" },
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(res.body.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-done"]);
    expect(res.body.upcoming[0]).not.toHaveProperty("source");
    expect(res.body.stats).toEqual({ total: 2 });
  });
});

describe("GET /api/calendar/deadlines/range", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    loadCompletedTaskIds.mockResolvedValue(new Set());
    hydrateRecurringTombstones.mockResolvedValue([
      { id: "todo-recurring", title: "Completed today", due_date: "2026-05-02", source: "todoist", status: "complete" },
    ]);
    computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
    fetchTodoistTasksRange.mockResolvedValue([
      { id: "dupe", title: "Mirrored item", due_date: "2026-05-04", source: "todoist", status: "incomplete" },
      { id: "todo-1", title: "Standalone item", due_date: "2026-05-05", source: "todoist", status: "incomplete" },
    ]);
    fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["dupe", "todo-1", "todo-recurring"]));
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
    listUpcomingReminderStatesForSources.mockResolvedValue(new Map([
      ["todoist_task:todo-1:", {
        hasUpcomingReminder: true,
        upcomingCount: 2,
        nextReminderAt: "2026-05-05T15:30:00.000Z",
      }],
    ]));
  });

  it("returns domain-shaped Todoist-backed rows, local completed rows, stats, and fetchedAt", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(fetchTodoistTasksRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2026-04-26", end: "2026-06-06" });
    expect(hydrateRecurringTombstones).toHaveBeenCalledWith(process.env.EA_USER_ID, new Set(["dupe", "todo-1", "todo-recurring"]), {
      start: "2026-04-26",
      end: "2026-06-06",
    });
    expect(res.body.upcoming.map((item) => item.id)).toEqual(["dupe", "todo-1", "todo-recurring"]);
    expect(res.body.upcoming.find((item) => item.id === "todo-1")).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 2,
      nextReminderAt: "2026-05-05T15:30:00.000Z",
    });
    expect(res.body.upcoming.find((item) => item.id === "todo-1")).not.toHaveProperty("source");
    expect(res.body.stats).toEqual({ total: 3 });
    expect(res.body.syncHealth).toEqual({ state: "current", configured: true, ageMs: 30_000 });
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
  });

  it("reports Todoist read errors with an empty deadline payload", async () => {
    fetchTodoistTasksRange.mockRejectedValueOnce(new Error("Todoist down"));
    fetchTodoistDueTaskIdSet.mockResolvedValueOnce(new Set());
    hydrateRecurringTombstones.mockResolvedValueOnce([]);

    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([]);
    expect(res.body.stats).toEqual({ total: 0 });
    expect(res.body.errors).toEqual([{ source: "todoist", message: "Todoist down" }]);
  });

  it("rejects calendar-domain ranges older than the rolling 12-month window", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2025-04-01&end=2025-04-30",
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/12-month/i);
  });

  it("allows adjacent-month grid spillover when the visible range overlaps the 12-month window", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2025-04-27&end=2025-06-07",
    );

    expect(res.status).toBe(200);
    expect(fetchTodoistTasksRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2025-04-27", end: "2025-06-07" });
  });
});

describe("GET /api/calendar/bills/range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    readBillsMirrorRange.mockResolvedValue({
      schedules: [{ id: "sched-1:2026-05-10", name: "Mortgage", next_date: "2026-05-10", paid: false }],
      recentTransactions: [],
      payeeMap: { p1: "Mortgage" },
      actualBudgetUrl: "http://actual.local",
      syncHealth: { state: "current", configured: true },
    });
    scheduleBillsMirrorRefresh.mockResolvedValue({ pendingRefreshAt: "2026-05-03T19:00:00.000Z" });
    isBillsMirrorMaintenanceDue.mockReturnValue(false);
    requestBillsCurrentMaintenanceRefresh.mockResolvedValue({ scheduled: false, due: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns range-backed bills payloads", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(readBillsMirrorRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2026-04-26", end: "2026-06-06" });
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.syncHealth).toEqual({ state: "current", configured: true });
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
    expect(scheduleBillsMirrorRefresh).not.toHaveBeenCalled();
    expect(requestBillsCurrentMaintenanceRefresh).not.toHaveBeenCalled();
  });

  it("returns existing bills range and requests quiet maintenance when mirror success is old", async () => {
    readBillsMirrorRange.mockResolvedValueOnce({
      schedules: [{ id: "sched-1:2026-05-10", name: "Mortgage", next_date: "2026-05-10", paid: false }],
      recentTransactions: [],
      payeeMap: { p1: "Mortgage" },
      actualBudgetUrl: "http://actual.local",
      syncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-03T18:40:00.000Z",
      },
    });
    isBillsMirrorMaintenanceDue.mockReturnValueOnce(true);

    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.syncHealth.state).toBe("current");
    expect(scheduleBillsMirrorRefresh).not.toHaveBeenCalled();
    expect(requestBillsCurrentMaintenanceRefresh).toHaveBeenCalledWith(process.env.EA_USER_ID, expect.objectContaining({
      now: expect.any(Date),
    }));
  });

  it("returns empty mirror data and schedules a background refresh when the mirror needs sync", async () => {
    readBillsMirrorRange.mockResolvedValueOnce({
      schedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: null,
      syncHealth: { state: "needs_sync", configured: null },
    });

    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.schedules).toEqual([]);
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.syncHealth).toEqual({ state: "needs_sync", configured: null });
    expect(res.body.errors).toEqual([]);
    expect(scheduleBillsMirrorRefresh).toHaveBeenCalledWith(process.env.EA_USER_ID);
  });
});
