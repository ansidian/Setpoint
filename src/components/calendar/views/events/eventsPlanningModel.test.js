import { describe, expect, it } from "vitest";
import {
  deadlinePlanningDescriptor,
  getDeadlineOverlayComputed,
  getPlanningItemId,
  isDeadlinePlanningItem,
  mergeDeadlineOverlayIntoEvents,
  orderPlanningItems,
} from "./eventsPlanningModel.js";

function event(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end || overrides.start).getTime(),
    allDay: !!overrides.allDay,
    ...overrides,
  };
}

function deadline(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    due_date: overrides.due_date,
    due_time: overrides.due_time || null,
    status: overrides.status || "incomplete",
    ...overrides,
  };
}

describe("events planning model", () => {
  it("normalizes deadline range data into overlay items and honors completed filtering", () => {
    const active = deadline({ id: "active", title: "Active", due_date: "2026-05-12" });
    const completed = deadline({ id: "done", title: "Done", due_date: "2026-05-12", status: "complete" });

    const visible = getDeadlineOverlayComputed({
      deadlineData: { upcoming: [active, completed] },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: false,
    });

    expect(visible.itemsByDate["2026-05-12"]).toHaveLength(1);
    expect(visible.itemsByDate["2026-05-12"][0]).toMatchObject({
      id: "active",
      calendarItemKind: "deadline",
      agendaDateKey: "2026-05-12",
      agendaItemId: "deadline:active:2026-05-12",
    });
    expect(visible.completedDeadlines).toBe(0);

    const withCompleted = getDeadlineOverlayComputed({
      deadlineData: { upcoming: [active, completed] },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });
    expect(withCompleted.itemsByDate["2026-05-12"]).toHaveLength(2);
    expect(withCompleted.completedDeadlines).toBe(1);
  });

  it("orders event spans and timed events before active deadlines, with completed deadlines last", () => {
    const ordered = orderPlanningItems([
      deadline({ id: "complete", title: "Complete", due_date: "2026-05-12", status: "complete" }),
      deadline({ id: "active", title: "Active", due_date: "2026-05-12", due_time: "5pm" }),
      event({ id: "timed", title: "Timed", start: "2026-05-12T18:00:00Z" }),
      event({ id: "all-day", title: "All day", start: "2026-05-12T07:00:00Z", allDay: true }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["all-day", "timed", "active", "complete"]);
  });

  it("merges deadline overlay items into events while preserving event item ids", () => {
    const timed = event({ id: "timed", title: "Timed", start: "2026-05-12T18:00:00Z" });
    const active = deadline({ id: "active", title: "Active", due_date: "2026-05-12" });
    const deadlineOverlay = getDeadlineOverlayComputed({
      deadlineData: { upcoming: [active] },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });

    const merged = mergeDeadlineOverlayIntoEvents({
      eventComputed: {
        itemsByDay: { 12: [timed] },
        itemsByDate: { "2026-05-12": [timed] },
        totalEvents: 1,
        allDayEvents: 0,
      },
      deadlineOverlayComputed: deadlineOverlay,
    });

    expect(merged.itemsByDate["2026-05-12"]).toHaveLength(2);
    expect(merged.itemsByDate["2026-05-12"].map(getPlanningItemId)).toEqual(["timed", "deadline:active:2026-05-12"]);
    expect(isDeadlinePlanningItem(merged.itemsByDate["2026-05-12"][1])).toBe(true);
    expect(merged.totalDeadlines).toBe(1);
  });

  it("keys deadline planning ids by occurrence date", () => {
    const first = deadline({ id: "same", title: "First occurrence", due_date: "2026-05-12" });
    const second = deadline({ id: "same", title: "Second occurrence", due_date: "2026-05-13" });
    const overlay = getDeadlineOverlayComputed({
      deadlineData: { upcoming: [first, second] },
      viewYear: 2026,
      viewMonth: 4,
      showCompleted: true,
    });

    expect([
      getPlanningItemId(overlay.itemsByDate["2026-05-12"][0]),
      getPlanningItemId(overlay.itemsByDate["2026-05-13"][0]),
    ]).toEqual([
      "deadline:same:2026-05-12",
      "deadline:same:2026-05-13",
    ]);
  });

  it("describes completed and in-progress deadline status for Events chips", () => {
    expect(deadlinePlanningDescriptor(deadline({
      id: "done",
      title: "Done task",
      due_date: "2026-05-12",
      status: "complete",
    }))).toMatchObject({
      statusIcon: "complete",
      statusLabel: "Complete",
      complete: true,
      quiet: true,
    });

    expect(deadlinePlanningDescriptor(deadline({
      id: "todo-progress",
      title: "Draft essay",
      due_date: "2026-05-12",
      status: "in_progress",
    }))).toMatchObject({
      statusIcon: "in_progress",
      statusLabel: "In progress",
      complete: false,
      quiet: false,
    });
  });

  it("carries deadline reminder state into Events planning chips", () => {
    expect(deadlinePlanningDescriptor(deadline({
      id: "reminder",
      title: "Reminder task",
      due_date: "2026-05-12",
      hasUpcomingReminder: true,
      upcomingReminderCount: 2,
      nextReminderAt: "2026-05-12T15:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingReminderCount: 2,
        nextReminderAt: "2026-05-12T15:30:00.000Z",
      },
    }))).toMatchObject({
      hasUpcomingReminder: true,
      upcomingReminderCount: 2,
      nextReminderAt: "2026-05-12T15:30:00.000Z",
      reminderState: {
        hasUpcomingReminder: true,
        upcomingReminderCount: 2,
        nextReminderAt: "2026-05-12T15:30:00.000Z",
      },
    });
  });
});
