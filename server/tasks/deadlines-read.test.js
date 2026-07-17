import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  computeDeadlineStats: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn(),
}));

vi.mock("./todoist.js", () => ({
  fetchTodoistTasks: (...args) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksAll: (...args) => testState.fetchTodoistTasksAll(...args),
  fetchTodoistTasksRange: (...args) => testState.fetchTodoistTasksRange(...args),
  fetchTodoistDueTaskIdSet: (...args) => testState.fetchTodoistDueTaskIdSet(...args),
  getTodoistSyncHealth: (...args) => testState.getTodoistSyncHealth(...args),
}));

vi.mock("./deadline-helpers.js", () => ({
  computeDeadlineStats: (...args) => testState.computeDeadlineStats(...args),
}));

vi.mock("./tombstones.js", () => ({
  hydrateRecurringTombstones: (...args) => testState.hydrateRecurringTombstones(...args),
}));

vi.mock("../reminders/reminder-service.ts", () => ({
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
    testState.fetchTodoistTasks.mockResolvedValue([{ id: "todo-1" }]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-1", "done-1"]));
    testState.hydrateRecurringTombstones.mockResolvedValue([
      { id: "done-1", status: "complete", due_date: "2026-05-04" },
    ]);
    testState.computeDeadlineStats.mockImplementation((items) => ({ total: items.length }));
    // Safe default so every test is order-independent: reminder hydration reads
    // stateByKey.get(...), which needs a Map. Without this, a test that doesn't set
    // its own value only passed because it inherited an earlier sibling test's
    // mockResolvedValue (clearAllMocks preserves return values) — breaks under reorder.
    testState.listUpcomingReminderStatesForSources.mockResolvedValue(new Map());
  });

  it("builds the current dashboard deadline payload from Todoist-backed deadline rows and stats", async () => {
    const payload = await readCurrentDeadlines("u1", { force: true });

    expect(testState.fetchTodoistTasks).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.fetchTodoistDueTaskIdSet).toHaveBeenCalledWith("u1", { refresh: true });
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-1", "done-1"]),
      { viewBoundary: "today" },
    );
    expect(payload).toEqual({
      upcoming: [
        {
          id: "todo-1",
          source: "todoist",
          sourceLabel: "Todoist",
          color: "#e44332",
          sourceColor: "#e44332",
        },
        {
          id: "done-1",
          status: "complete",
          due_date: "2026-05-04",
          source: "todoist",
          sourceLabel: "Todoist",
          color: "#e44332",
          sourceColor: "#e44332",
        },
      ],
      stats: { total: 2 },
    });
  });

  it("surfaces every live Todoist mirror row without a separate completed-id reconciliation pass", async () => {
    // Post-migration-014 suppression lives in the mirror (checked=0) and the
    // tombstone path, not in a deadlines-read filter. The read must pass mirror
    // rows straight through even when an id collides with a dated tombstone.
    testState.fetchTodoistTasks.mockResolvedValue([
      { id: "todo-live", due_date: "2026-05-09" },
    ]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-live"]));
    testState.hydrateRecurringTombstones.mockResolvedValue([]);

    const payload = await readCurrentDeadlines("u1");

    expect(payload.upcoming.map((item) => item.id)).toEqual(["todo-live"]);
  });

  it("skips completed tombstones already present in the current Todoist mirror rows", async () => {
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

    expect(payload.upcoming).toEqual([
      {
        id: "todo-done",
        title: "Completed task",
        due_date: "2026-05-11",
        status: "complete",
        source: "todoist",
        sourceLabel: "Todoist",
        color: "#e44332",
        sourceColor: "#e44332",
      },
    ]);
    expect(payload.stats).toEqual({ total: 1 });
  });

  it("builds the all-calendar deadline payload with Todoist sync health and reminder state", async () => {
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
      stats: { total: 2 },
      syncHealth: { state: "current", configured: true },
    });
    expect(payload.upcoming.find((item) => item.id === "todo-all")).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-05-05T15:30:00.000Z",
    });
    expect(payload.upcoming.find((item) => item.id === "todo-all")).toMatchObject({
      source: "todoist",
      sourceLabel: "Todoist",
      color: "#e44332",
      sourceColor: "#e44332",
    });
  });

  it("builds the range-calendar deadline payload from Todoist rows and tombstones", async () => {
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

    expect(testState.fetchTodoistTasksRange).toHaveBeenCalledWith("u1", {
      start: "2026-05-05",
      end: "2026-05-10",
    });
    expect(testState.hydrateRecurringTombstones).toHaveBeenCalledWith(
      "u1",
      new Set(["todo-range", "done-out", "done-in"]),
      { start: "2026-05-05", end: "2026-05-10" },
    );
    expect(result.errors).toEqual([]);
    expect(result.payload.upcoming.map((item) => item.id)).toEqual(["todo-range", "done-in"]);
    expect(result.payload.stats).toEqual({ total: 2 });
    expect(result.payload.syncHealth).toEqual({ state: "current", configured: true });
    expect(result.payload.upcoming.find((item) => item.id === "todo-range")).toMatchObject({
      source: "todoist",
      sourceLabel: "Todoist",
      color: "#e44332",
      sourceColor: "#e44332",
    });
  });
});
