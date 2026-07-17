import { describe, expect, it } from "vitest";
import {
  applyUpcomingReminderState,
  formatReminderSummary,
  projectUpcomingReminderState,
} from "./reminderDisplay.ts";

describe("reminderDisplay", () => {
  it("projects the earliest pending future reminder for local post-commit updates", () => {
    const state = projectUpcomingReminderState([
      { id: "later", status: "pending", remindAt: "2099-05-10T18:00:00.000Z" },
      { id: "sent", status: "sent", remindAt: "2099-05-10T16:30:00.000Z" },
      { id: "earliest", status: "pending", remindAt: "2099-05-10T17:00:00.000Z" },
      { id: "past", status: "pending", remindAt: "2026-05-10T15:59:00.000Z" },
    ], { now: "2026-05-10T16:00:00.000Z" });

    expect(state).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 2,
      nextReminderAt: "2099-05-10T17:00:00.000Z",
    });
  });

  it("applies an empty projection when all reminder chips are removed or fired", () => {
    const projected = applyUpcomingReminderState(
      { id: "todo-1", title: "Submit" },
      projectUpcomingReminderState([
        { id: "sent", status: "sent", remind_at: "2099-05-10T17:00:00.000Z" },
      ], { now: "2026-05-10T16:00:00.000Z" }),
    );

    expect(projected).toMatchObject({
      hasUpcomingReminder: false,
      upcomingReminderCount: 0,
      nextReminderAt: null,
      reminderState: {
        hasUpcomingReminder: false,
        upcomingCount: 0,
        nextReminderAt: null,
      },
    });
    expect(formatReminderSummary(projected)).toBeNull();
  });

  it("can recompute reminder times from a moved item anchor and reminder offsets", () => {
    const state = projectUpcomingReminderState([
      { id: "one-hour", status: "pending", offset_minutes: -60, remind_at: "2099-05-10T16:00:00.000Z" },
      { id: "ten-min", status: "pending", offsetMinutes: -10, remindAt: "2099-05-10T16:50:00.000Z" },
    ], {
      now: "2026-05-10T16:00:00.000Z",
      anchorAt: "2099-05-11T20:00:00.000Z",
    });

    expect(state).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 2,
      nextReminderAt: "2099-05-11T19:00:00.000Z",
    });
  });

  it("formats reminder summaries for compact dashboard and agenda labels", () => {
    const item = (nextReminderAt: string) => ({
      reminderState: {
        hasUpcomingReminder: true,
        upcomingCount: 1,
        nextReminderAt,
      },
    });
    const now = "2026-05-11T16:00:00.000Z";

    expect(formatReminderSummary(item("2026-05-11T20:32:00.000Z"), { now })).toBe("Reminder in 4h 32m");
    expect(formatReminderSummary(item("2026-05-12T04:00:00.000Z"), { now })).toBe("Reminder 9:00 PM");
    expect(formatReminderSummary(item("2026-05-13T20:00:00.000Z"), { now })).toBe("Reminder May 13, 1:00 PM");
  });
});
