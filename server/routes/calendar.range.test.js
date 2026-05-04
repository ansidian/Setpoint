import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock deps before importing the route
vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../briefing/index.js", () => ({
  loadUserConfig: vi.fn(),
  separateDeadlines: vi.fn(),
  computeDeadlineStats: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
  carryForwardCompletedTodoist: vi.fn(),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: vi.fn(),
  pacificDayBoundaries: vi.fn((date) => ({ dayStart: date, dayEnd: date })),
}));
vi.mock("../briefing/ctm.js", () => ({
  fetchCTMDeadlinesAll: vi.fn(),
  fetchCTMDeadlinesRange: vi.fn(),
}));
vi.mock("../briefing/todoist.js", () => ({
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
}));
vi.mock("../briefing/actual.js", () => ({
  getCalendarBillsRange: vi.fn(),
}));
vi.mock("../briefing/tombstones.js", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));

const {
  computeDeadlineStats,
  loadCompletedTaskIds,
  loadUserConfig,
  separateDeadlines,
} = await import("../briefing/index.js");
const { fetchCalendar } = await import("../briefing/calendar.js");
const { fetchCTMDeadlinesAll, fetchCTMDeadlinesRange } = await import("../briefing/ctm.js");
const { fetchTodoistTasksAll, fetchTodoistTasksRange, getTodoistSyncHealth } = await import("../briefing/todoist.js");
const { getCalendarBillsRange } = await import("../briefing/actual.js");
const { hydrateRecurringTombstones } = await import("../briefing/tombstones.js");
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
      { title: "Test event", startMs: 1, endMs: 2, source: "x@y.com", color: "#abc" },
    ]);
    fetchCTMDeadlinesRange.mockResolvedValue([]);
    fetchTodoistTasksRange.mockResolvedValue([]);
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
    getCalendarBillsRange.mockResolvedValue({ schedules: [], recentTransactions: [], payeeMap: {} });
    hydrateRecurringTombstones.mockResolvedValue([]);
    loadCompletedTaskIds.mockResolvedValue(new Set());
    separateDeadlines.mockImplementation((ctm, todoist) => ({ ctm, todoist }));
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
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-18&end=2026-04-25",
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
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
    fetchCTMDeadlinesAll.mockResolvedValue([]);
    fetchTodoistTasksAll.mockResolvedValue([
      { id: "todo-open", title: "Open task", due_date: "2026-05-04", source: "todoist", status: "incomplete" },
    ]);
    hydrateRecurringTombstones.mockResolvedValue([
      { id: "todo-done", title: "Completed task", due_date: "2026-05-03", source: "todoist", status: "complete", _tombstone: true },
    ]);
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
    loadCompletedTaskIds.mockResolvedValue(new Set());
    separateDeadlines.mockImplementation((ctm, todoist) => ({ ctm, todoist }));
    computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
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
      { viewBoundary: "yesterday" },
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(res.body.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-done"]);
    expect(res.body.todoist.stats).toEqual({ total: 2 });
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
    separateDeadlines.mockImplementation((ctm, todoist) => ({
      ctm: ctm.filter((deadline) => !todoist.some((task) => String(deadline.todoist_id) === String(task.id))),
      todoist,
    }));
    computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
    fetchCTMDeadlinesRange.mockResolvedValue([
      { id: "ctm-1", title: "Canvas item", due_date: "2026-05-04", status: "complete", todoist_id: "dupe" },
    ]);
    fetchTodoistTasksRange.mockResolvedValue([
      { id: "dupe", title: "Mirrored item", due_date: "2026-05-04", source: "todoist", status: "complete" },
      { id: "todo-1", title: "Standalone item", due_date: "2026-05-05", source: "todoist", status: "complete" },
    ]);
    getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true, ageMs: 30_000 });
  });

  it("returns range-backed CTM, Todoist, tombstones, stats, and fetchedAt", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(fetchCTMDeadlinesRange).toHaveBeenCalledWith({ start: "2026-04-26", end: "2026-06-06" });
    expect(fetchTodoistTasksRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2026-04-26", end: "2026-06-06" });
    expect(res.body.ctm.upcoming.map((item) => item.id)).toEqual([]);
    expect(res.body.todoist.upcoming.map((item) => item.id)).toEqual(["dupe", "todo-1", "todo-recurring"]);
    expect(res.body.ctm.stats).toEqual({ total: 0 });
    expect(res.body.todoist.stats).toEqual({ total: 3 });
    expect(res.body.todoist.syncHealth).toEqual({ state: "current", configured: true, ageMs: 30_000 });
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
  });

  it("keeps available deadline source data when another source fails", async () => {
    fetchCTMDeadlinesRange.mockRejectedValueOnce(new Error("CTM down"));

    const res = await request(makeApp()).get(
      "/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.ctm.upcoming).toEqual([]);
    expect(res.body.todoist.upcoming.map((item) => item.id)).toEqual(["dupe", "todo-1", "todo-recurring"]);
    expect(res.body.errors).toEqual([{ source: "ctm", message: "CTM down" }]);
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
    expect(fetchCTMDeadlinesRange).toHaveBeenCalledWith({ start: "2025-04-27", end: "2025-06-07" });
  });
});

describe("GET /api/calendar/bills/range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    getCalendarBillsRange.mockResolvedValue({
      schedules: [{ id: "sched-1:2026-05-10", name: "Mortgage", next_date: "2026-05-10", paid: false }],
      recentTransactions: [],
      payeeMap: { p1: "Mortgage" },
      actualBudgetUrl: "http://actual.local",
    });
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
    expect(getCalendarBillsRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2026-04-26", end: "2026-06-06" });
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
  });

  it("returns an empty bills payload with source errors when Actual fails", async () => {
    getCalendarBillsRange.mockRejectedValueOnce(new Error("Actual offline"));

    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.schedules).toEqual([]);
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.errors).toEqual([{ source: "actual", message: "Actual offline" }]);
  });
});
