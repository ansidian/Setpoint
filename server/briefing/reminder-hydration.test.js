import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  listUpcomingReminderStatesForSources: vi.fn(),
}));

vi.mock("./reminder-service.js", () => ({
  listUpcomingReminderStatesForSources: (...args) => testState.listUpcomingReminderStatesForSources(...args),
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }) => (
    `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`
  ),
}));

const {
  hydrateCalendarEventsWithReminderState,
  hydrateTodoistTasksWithReminderState,
} = await import("./reminder-hydration.js");

describe("reminder hydration module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.listUpcomingReminderStatesForSources.mockResolvedValue(new Map());
  });

  it("hydrates calendar event reminder state using recurring occurrence identity", async () => {
    testState.listUpcomingReminderStatesForSources.mockResolvedValueOnce(new Map([
      ["calendar_event:event-1:2026-05-05T15:00:00.000Z", {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-05-05T14:45:00.000Z",
      }],
    ]));

    const events = await hydrateCalendarEventsWithReminderState("u1", [
      {
        id: "event-1",
        isRecurring: true,
        originalStartTime: "2026-05-05T15:00:00.000Z",
        startMs: Date.parse("2026-05-05T15:00:00.000Z"),
      },
    ]);

    expect(testState.listUpcomingReminderStatesForSources).toHaveBeenCalledWith({
      userId: "u1",
      sources: [{
        sourceType: "calendar_event",
        sourceItemId: "event-1",
        sourceOccurrenceId: "2026-05-05T15:00:00.000Z",
      }],
    });
    expect(events[0]).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 1,
      nextReminderAt: "2026-05-05T14:45:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt: "2026-05-05T14:45:00.000Z",
      },
    });
  });

  it("hydrates Todoist tasks and supplies the empty reminder state when no row exists", async () => {
    const tasks = await hydrateTodoistTasksWithReminderState("u1", [{ id: 123 }]);

    expect(testState.listUpcomingReminderStatesForSources).toHaveBeenCalledWith({
      userId: "u1",
      sources: [{
        sourceType: "todoist_task",
        sourceItemId: "123",
        sourceOccurrenceId: null,
      }],
    });
    expect(tasks[0]).toMatchObject({
      reminderState: {
        hasUpcomingReminder: false,
        upcomingCount: 0,
        nextReminderAt: null,
      },
      hasUpcomingReminder: false,
      upcomingReminderCount: 0,
      nextReminderAt: null,
    });
  });
});
