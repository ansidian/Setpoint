import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  fetchCTMDeadlines: vi.fn(),
  fetchCTMDeadlinesAll: vi.fn(),
  fetchCTMDeadlinesRange: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
  separateDeadlines: vi.fn(),
  computeDeadlineStats: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn(),
}));

vi.mock("./ctm.js", () => ({
  fetchCTMDeadlines: (...args) => testState.fetchCTMDeadlines(...args),
  fetchCTMDeadlinesAll: (...args) => testState.fetchCTMDeadlinesAll(...args),
  fetchCTMDeadlinesRange: (...args) => testState.fetchCTMDeadlinesRange(...args),
}));

vi.mock("./todoist.js", () => ({
  fetchTodoistTasks: (...args) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksAll: (...args) => testState.fetchTodoistTasksAll(...args),
  fetchTodoistTasksRange: (...args) => testState.fetchTodoistTasksRange(...args),
  fetchTodoistDueTaskIdSet: (...args) => testState.fetchTodoistDueTaskIdSet(...args),
  getTodoistSyncHealth: (...args) => testState.getTodoistSyncHealth(...args),
}));

vi.mock("./deadline-helpers.js", () => ({
  loadCompletedTaskIds: (...args) => testState.loadCompletedTaskIds(...args),
  separateDeadlines: (...args) => testState.separateDeadlines(...args),
  computeDeadlineStats: (...args) => testState.computeDeadlineStats(...args),
}));

vi.mock("./tombstones.js", () => ({
  hydrateRecurringTombstones: (...args) => testState.hydrateRecurringTombstones(...args),
}));

vi.mock("./reminder-service.js", () => ({
  listUpcomingReminderStatesForSources: (...args) => testState.listUpcomingReminderStatesForSources(...args),
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }) => (
    `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`
  ),
}));

const {
  readCalendarDeadlines,
  readCalendarDeadlineRange,
  readCurrentDeadlines,
} = await import("./deadlines-read.js");

describe("deadline read module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.fetchCTMDeadlines.mockResolvedValue([{ id: "ctm-1" }]);
    testState.fetchTodoistTasks.mockResolvedValue([{ id: "todo-1" }]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-1", "done-1"]));
    testState.loadCompletedTaskIds.mockResolvedValue(new Set());
    testState.separateDeadlines.mockImplementation((ctm, todoist) => ({ ctm, todoist }));
    testState.hydrateRecurringTombstones.mockResolvedValue([
      { id: "done-1", status: "complete", due_date: "2026-05-04" },
    ]);
    testState.computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
  });

  it("builds the current dashboard deadline payload from CTM, Todoist, tombstones, and stats", async () => {
    const payload = await readCurrentDeadlines("u1", { force: true });

    expect(testState.fetchCTMDeadlines).toHaveBeenCalledTimes(1);
    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.fetchTodoistDueTaskIdSet).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.loadCompletedTaskIds).toHaveBeenCalledWith("u1", [{ id: "todo-1" }]);
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-1", "done-1"]),
      { viewBoundary: "today" },
    );
    expect(payload).toEqual({
      ctm: { upcoming: [{ id: "ctm-1" }], stats: { total: 1 } },
      todoist: {
        upcoming: [
          { id: "todo-1" },
          { id: "done-1", status: "complete", due_date: "2026-05-04" },
        ],
        stats: { total: 2 },
      },
    });
  });

  it("skips completed tombstones already present in the current Todoist mirror rows", async () => {
    testState.fetchCTMDeadlines.mockResolvedValue([]);
    testState.fetchTodoistTasks.mockResolvedValue([
      {
        id: "todo-done",
        title: "Completed task",
        due_date: "2026-05-11",
        source: "todoist",
        status: "complete",
      },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-done"]));
    testState.hydrateRecurringTombstones.mockResolvedValue([
      {
        id: "todo-done",
        title: "Completed task",
        due_date: "2026-05-11",
        source: "todoist",
        status: "complete",
        _tombstone: true,
      },
    ]);

    const payload = await readCurrentDeadlines("u1");

    expect(payload.todoist.upcoming).toEqual([
      {
        id: "todo-done",
        title: "Completed task",
        due_date: "2026-05-11",
        source: "todoist",
        status: "complete",
      },
    ]);
    expect(payload.todoist.stats).toEqual({ total: 1 });
  });

  it("builds the all-calendar deadline payload with Todoist sync health and reminder state", async () => {
    testState.fetchCTMDeadlinesAll.mockResolvedValue([{ id: "ctm-all" }]);
    testState.fetchTodoistTasksAll.mockResolvedValue([
      { id: "todo-all", title: "Open task", due_date: "2026-05-05" },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-all"]));
    testState.getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true });
    testState.hydrateRecurringTombstones.mockResolvedValue([
      { id: "done-all", status: "complete", due_date: "2026-05-03" },
    ]);
    testState.listUpcomingReminderStatesForSources.mockResolvedValue(new Map([
      ["todoist_task:todo-all:", {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-05-05T15:30:00.000Z",
      }],
    ]));

    const payload = await readCalendarDeadlines("u1");

    expect(testState.fetchTodoistTasksAll).toHaveBeenCalledWith("u1");
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-all"]),
      { viewBoundary: "today" },
    );
    expect(testState.listUpcomingReminderStatesForSources).toHaveBeenCalledWith({
      userId: "u1",
      sources: [
        { sourceType: "todoist_task", sourceItemId: "todo-all", sourceOccurrenceId: null },
        { sourceType: "todoist_task", sourceItemId: "done-all", sourceOccurrenceId: null },
      ],
    });
    expect(payload).toMatchObject({
      ctm: { upcoming: [{ id: "ctm-all" }], stats: { total: 1 } },
      todoist: {
        stats: { total: 2 },
        syncHealth: { state: "current", configured: true },
      },
    });
    expect(payload.todoist.upcoming.find((item) => item.id === "todo-all")).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-05-05T15:30:00.000Z",
    });
  });

  it("builds the range-calendar deadline payload while preserving available sources when CTM fails", async () => {
    const ctmError = new Error("CTM down");
    testState.fetchCTMDeadlinesRange.mockRejectedValue(ctmError);
    testState.fetchTodoistTasksRange.mockResolvedValue([
      { id: "todo-range", due_date: "2026-05-06" },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-range", "done-out", "done-in"]));
    testState.getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true });
    testState.hydrateRecurringTombstones.mockResolvedValue([
      { id: "done-out", due_date: "2026-05-01", status: "complete" },
      { id: "todo-range", due_date: "2026-05-06", status: "complete", _tombstone: true },
      { id: "done-in", due_date: "2026-05-07", status: "complete" },
    ]);

    const result = await readCalendarDeadlineRange("u1", {
      start: "2026-05-05",
      end: "2026-05-10",
    });

    expect(testState.fetchCTMDeadlinesRange).toHaveBeenCalledWith({
      start: "2026-05-05",
      end: "2026-05-10",
    });
    expect(testState.fetchTodoistTasksRange).toHaveBeenCalledWith("u1", {
      start: "2026-05-05",
      end: "2026-05-10",
    });
    expect(result.errors).toEqual([{ source: "ctm", message: "CTM down" }]);
    expect(result.payload.ctm.upcoming).toEqual([]);
    expect(result.payload.todoist.upcoming.map((item) => item.id)).toEqual(["todo-range", "done-in"]);
    expect(result.payload.todoist.stats).toEqual({ total: 2 });
    expect(result.payload.todoist.syncHealth).toEqual({ state: "current", configured: true });
  });
});
