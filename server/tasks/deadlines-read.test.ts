import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderSourceIdentity } from "../../shared/types/reminders.ts";

const testState = vi.hoisted(() => ({
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- The Todoist mirror/provider facade is the deadline reader's external durable source; cases drive its public read outcomes through the stable deadline facade.
vi.mock("./todoist.ts", () => ({
  fetchTodoistTasks: testState.fetchTodoistTasks,
  fetchTodoistTasksAll: testState.fetchTodoistTasksAll,
  fetchTodoistTasksRange: testState.fetchTodoistTasksRange,
  fetchTodoistDueTaskIdSet: testState.fetchTodoistDueTaskIdSet,
  getTodoistSyncHealth: testState.getTodoistSyncHealth,
}));

// test-architecture: allow-boundary-mock -- Completed-occurrence tombstones are durable task-history input; their migrated persistence behavior is owned by tombstones tests.
vi.mock("./tombstones.ts", () => ({
  hydrateRecurringTombstones: testState.hydrateRecurringTombstones,
}));

// test-architecture: allow-boundary-mock -- Reminder hydration reads a separately persisted reminder domain; reader cases provide its public source-state projection.
vi.mock("../reminders/reminder-service.ts", () => ({
  listUpcomingReminderStatesForSources: testState.listUpcomingReminderStatesForSources,
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }: ReminderSourceIdentity) => (
    `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`
  ),
}));

const {
  readCalendarDeadlines,
  readCalendarDeadlineRange,
  readCurrentDeadlines,
} = await import("./deadlines-read.ts");

describe("deadline read module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.fetchTodoistTasks.mockResolvedValue([{ id: "todo-1" }]);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-1", "done-1"]));
    testState.hydrateRecurringTombstones.mockResolvedValue([
      { id: "done-1", status: "complete", due_date: "2026-05-04" },
    ]);
    // Safe default so every test is order-independent: reminder hydration reads
    // stateByKey.get(...), which needs a Map. Without this, a test that doesn't set
    // its own value only passed because it inherited an earlier sibling test's
    // mockResolvedValue (clearAllMocks preserves return values) — breaks under reorder.
    testState.listUpcomingReminderStatesForSources.mockResolvedValue(new Map());
  });

  it("builds the current dashboard deadline payload from Todoist-backed deadline rows and stats", async () => {
    testState.fetchTodoistTasks.mockImplementation(async (userId, options) => (
      userId === "u1" && options?.refresh === true ? [{ id: "todo-1" }] : []
    ));
    testState.fetchTodoistDueTaskIdSet.mockImplementation(async (userId, options) => (
      userId === "u1" && options?.refresh === true ? new Set(["todo-1", "done-1"]) : new Set()
    ));
    testState.hydrateRecurringTombstones.mockImplementation(async (userId, ids, options) => (
      userId === "u1" && ids?.has("done-1") && options?.viewBoundary === "today"
        ? [{ id: "done-1", status: "complete", due_date: "2026-05-04" }]
        : []
    ));
    const payload = await readCurrentDeadlines("u1", { force: true });

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
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
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
    expect(payload.stats).toEqual({ incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 });
  });

  it("builds the all-calendar deadline payload with Todoist sync health and reminder state", async () => {
    testState.fetchTodoistTasksAll.mockImplementation(async (userId) => userId === "u1"
      ? [{ id: "todo-all", title: "Open task", due_date: "2026-05-05" }]
      : []);
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-all"]));
    testState.getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true });
    testState.hydrateRecurringTombstones.mockImplementation(async (userId, ids, options) => (
      userId === "u1" && ids?.has("todo-all") && options?.viewBoundary === "today"
        ? [{ id: "done-all", status: "complete", due_date: "2026-05-03" }]
        : []
    ));
    testState.listUpcomingReminderStatesForSources.mockImplementation(async ({ userId, sources }) => (
      userId === "u1" && sources.length === 2
        ? new Map([["todoist_task:todo-all:", {
            hasUpcomingReminder: true,
            upcomingCount: 1,
            nextReminderAt: "2026-05-05T15:30:00.000Z",
          }]])
        : new Map()
    ));

    const payload = await readCalendarDeadlines("u1");

    expect(payload).toMatchObject({
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
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
    testState.fetchTodoistTasksRange.mockImplementation(async (userId, range) => (
      userId === "u1" && range.start === "2026-05-05" && range.end === "2026-05-10"
        ? [{ id: "todo-range", due_date: "2026-05-06" }]
        : []
    ));
    testState.fetchTodoistDueTaskIdSet.mockResolvedValue(new Set(["todo-range", "done-out", "done-in"]));
    testState.getTodoistSyncHealth.mockResolvedValue({ state: "current", configured: true });
    testState.hydrateRecurringTombstones.mockImplementation(async (userId, ids, range) => (
      userId === "u1" && ids?.has("done-in")
        && range.start === "2026-05-05" && range.end === "2026-05-10"
        ? [
            { id: "done-out", due_date: "2026-05-01", status: "complete" },
            { id: "todo-range", due_date: "2026-05-06", status: "complete", _tombstone: true },
            { id: "done-in", due_date: "2026-05-07", status: "complete" },
          ]
        : []
    ));

    const result = await readCalendarDeadlineRange("u1", {
      start: "2026-05-05",
      end: "2026-05-10",
    });

    expect(result.errors).toEqual([]);
    expect(result.payload.upcoming.map((item) => item.id)).toEqual(["todo-range", "done-in"]);
    expect(result.payload.stats).toEqual({ incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 });
    expect(result.payload.syncHealth).toEqual({ state: "current", configured: true });
    expect(result.payload.upcoming.find((item) => item.id === "todo-range")).toMatchObject({
      source: "todoist",
      sourceLabel: "Todoist",
      color: "#e44332",
      sourceColor: "#e44332",
    });
  });
});
