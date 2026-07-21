import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import type { BillsMirrorHealth } from "../../shared/types/bills.ts";

type MockFunction = ReturnType<typeof vi.fn>;

// Mock deps before importing the route
vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../platform/config-service.ts", () => ({
  loadUserConfig: vi.fn(),
}));
vi.mock("../tasks/deadline-helpers.ts", () => ({
  filterCompletedTodoistTasks: vi.fn((tasks: Array<Record<string, unknown>>, completedIds?: Set<unknown>) => (
    (tasks || []).filter((task) => !completedIds?.has(task.id) && !completedIds?.has(String(task.id)))
  )),
  computeDeadlineStats: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
}));
vi.mock("../calendar/calendar.ts", async () => {
  const { validateCalendarRange } = await import("../calendar/calendar-range-model.ts");
  return {
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
    validateCalendarRange,
    isCalendarSearchInputError: vi.fn(() => false),
    searchCalendar: vi.fn(),
  };
});
vi.mock("../calendar/calendar-search-mirror.ts", async (importActual) => ({
  // Keep the real pure helpers (addMonthsIso powers validateCalendarRange in the route);
  // only the DB-touching functions are stubbed below.
  ...(await importActual()),
  deleteCalendarSearchMirrorOccurrence: vi.fn(),
  getCalendarSearchMirrorHealth: vi.fn(),
  listCalendarSearchMirrorOccurrences: vi.fn(),
  markCalendarSearchMirrorDirty: vi.fn(),
  requestCalendarSearchMirrorSync: vi.fn(),
  upsertCalendarSearchMirrorOccurrence: vi.fn(),
}));
vi.mock("../tasks/todoist.ts", () => ({
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
}));
vi.mock("../bills/bills-service.ts", () => ({
  isBillsMirrorMaintenanceDue: vi.fn(),
  readBillsMirrorRange: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
  shouldScheduleImmediateBillsRefresh: (health: BillsMirrorHealth | null | undefined, now?: Date) => {
    if (health?.state !== "needs_sync") return false;
    const pendingAt = health?.pendingRefreshAt ? new Date(health.pendingRefreshAt).getTime() : null;
    return pendingAt === null || pendingAt <= new Date(now ?? Date.now()).getTime();
  },
}));
vi.mock("../transactions/transactions-service.ts", () => ({
  queryTransactions: vi.fn(),
}));
vi.mock("../dashboard/current-service.ts", () => ({
  applyDeadlineCurrentStatus: vi.fn(),
  requestBillsCurrentMaintenanceRefresh: vi.fn(),
}));
vi.mock("../tasks/tasks-service.ts", () => ({
  completeDeadlineOccurrence: vi.fn(),
  createDeadline: vi.fn(),
  deleteDeadline: vi.fn(),
  updateDeadline: vi.fn(),
}));
vi.mock("../platform/google-places.ts", () => ({
  getGooglePlaceDetails: vi.fn(),
  suggestGooglePlaces: vi.fn(),
}));
vi.mock("../tasks/tombstones.ts", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../reminders/reminder-service.ts", () => ({
  deleteSourceReminders: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn(),
  recomputeUnsentRemindersForSource: vi.fn(),
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }: { sourceType: string; sourceItemId: string; sourceOccurrenceId?: string | null }) => `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`,
}));
vi.mock("../db/connection.ts", () => ({ default: { execute: vi.fn() } }));

const {
  computeDeadlineStats,
  loadCompletedTaskIds,
} = await import("../tasks/deadline-helpers.ts") as unknown as { computeDeadlineStats: MockFunction; loadCompletedTaskIds: MockFunction };
const { loadUserConfig } = await import("../platform/config-service.ts") as unknown as { loadUserConfig: MockFunction };
const { fetchCalendar } = await import("../calendar/calendar.ts") as unknown as { fetchCalendar: MockFunction };
const { fetchTodoistDueTaskIdSet, fetchTodoistTasksRange, getTodoistSyncHealth } = await import("../tasks/todoist.ts") as unknown as Record<"fetchTodoistDueTaskIdSet" | "fetchTodoistTasksRange" | "getTodoistSyncHealth", MockFunction>;
const { isBillsMirrorMaintenanceDue, readBillsMirrorRange, scheduleBillsMirrorRefresh } = await import("../bills/bills-service.ts") as unknown as Record<"isBillsMirrorMaintenanceDue" | "readBillsMirrorRange" | "scheduleBillsMirrorRefresh", MockFunction>;
const { queryTransactions } = await import("../transactions/transactions-service.ts") as unknown as { queryTransactions: MockFunction };
const { requestBillsCurrentMaintenanceRefresh } = await import("../dashboard/current-service.ts") as unknown as { requestBillsCurrentMaintenanceRefresh: MockFunction };
const { hydrateRecurringTombstones } = await import("../tasks/tombstones.ts") as unknown as { hydrateRecurringTombstones: MockFunction };
const { listUpcomingReminderStatesForSources } = await import("../reminders/reminder-service.ts") as unknown as { listUpcomingReminderStatesForSources: MockFunction };
const calendarRoutes = (await import("./calendar.ts")).default;

function makeApp() {
  const app = express();
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("GET /api/calendar/range", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
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

});

describe("GET /api/calendar/deadlines/range", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
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
    expect(res.body.upcoming.map((item: { id: string }) => item.id)).toEqual(["dupe", "todo-1", "todo-recurring"]);
    expect(res.body.upcoming.find((item: { id: string }) => item.id === "todo-1")).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 2,
      nextReminderAt: "2026-05-05T15:30:00.000Z",
      source: "todoist",
      sourceLabel: "Todoist",
      color: "#e44332",
      sourceColor: "#e44332",
    });
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

});

describe("GET /api/calendar/bills/range", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
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
    queryTransactions.mockResolvedValue({
      total: 2,
      transactions: [
        { id: "income-1", date: "2026-05-09", amount: 5000, direction: "income", payee: "Employer" },
        { id: "expense-1", date: "2026-05-08", amount: 42.1, direction: "expense", payee: "Trader Joes" },
      ],
      truncated: false,
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
    expect(readBillsMirrorRange).toHaveBeenCalledWith(process.env.EA_USER_ID, { start: "2026-04-26", end: "2026-06-06" });
    expect(res.body.schedules).toHaveLength(1);
    expect(queryTransactions).toHaveBeenCalledWith(process.env.EA_USER_ID, {
      start: "2026-04-26",
      end: "2026-06-06",
      direction: "all",
      limit: 5000,
    });
    expect(res.body.transactions).toEqual([
      expect.objectContaining({ id: "income-1", direction: "income" }),
      expect.objectContaining({ id: "expense-1", direction: "expense" }),
    ]);
    expect(res.body.transactionsTruncated).toBe(false);
    expect(res.body.syncHealth).toEqual({ state: "current", configured: true });
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
    expect(scheduleBillsMirrorRefresh).not.toHaveBeenCalled();
    expect(requestBillsCurrentMaintenanceRefresh).not.toHaveBeenCalled();
  });

  it("keeps scheduled bills available when transactions are unavailable", async () => {
    queryTransactions.mockResolvedValueOnce({ error: "transactions unavailable — budget not synced" });

    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.transactions).toEqual([]);
    expect(res.body.transactionsTruncated).toBe(false);
    expect(res.body.errors).toEqual([{
      source: "transactions",
      message: "transactions unavailable — budget not synced",
    }]);
  });

  it("reports when the calendar transaction range is truncated", async () => {
    queryTransactions.mockResolvedValueOnce({
      total: 5000,
      transactions: [{ id: "expense-1", date: "2026-05-08", amount: 42, direction: "expense" }],
      truncated: true,
    });

    const res = await request(makeApp()).get(
      "/api/calendar/bills/range?start=2026-04-26&end=2026-06-06",
    );

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactionsTruncated).toBe(true);
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
    expect(res.body.recentTransactions).toBeUndefined();
    expect(res.body.transactions).toHaveLength(2);
    expect(res.body.syncHealth).toEqual({ state: "needs_sync", configured: null });
    expect(res.body.errors).toEqual([]);
    expect(scheduleBillsMirrorRefresh).toHaveBeenCalledWith(process.env.EA_USER_ID);
  });
});
