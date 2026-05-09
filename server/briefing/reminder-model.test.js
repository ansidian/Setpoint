import { describe, expect, it } from "vitest";
import {
  computeReminderState,
  createReminderDraft,
  projectUpcomingReminderState,
  resolveReminderAnchor,
} from "./reminder-model.js";

describe("reminder model", () => {
  it("anchors calendar events to start time and converts custom reminder time to a moving offset", () => {
    const anchor = resolveReminderAnchor({
      sourceType: "calendar_event",
      startAt: "2026-05-10T17:00:00.000Z",
    });

    expect(anchor).toEqual({
      anchorKind: "event_start",
      anchorAt: "2026-05-10T17:00:00.000Z",
    });
    expect(createReminderDraft({
      anchorAt: anchor.anchorAt,
      remindAt: "2026-05-10T16:30:00.000Z",
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    })).toMatchObject({
      offsetMinutes: -30,
      remindAt: "2026-05-10T16:30:00.000Z",
      blocked: false,
    });
  });

  it("anchors Todoist date-only tasks at 9 AM Pacific instead of midnight", () => {
    expect(resolveReminderAnchor({
      sourceType: "todoist_task",
      dueDate: "2026-05-10",
    })).toEqual({
      anchorKind: "todoist_date_9am_pacific",
      anchorAt: "2026-05-10T16:00:00.000Z",
    });
  });

  it("blocks duplicate and past reminder options", () => {
    const duplicate = createReminderDraft({
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -60,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [{ offset_minutes: -60, status: "pending" }],
    });
    const past = createReminderDraft({
      anchorAt: "2026-05-10T17:00:00.000Z",
      offsetMinutes: -180,
      now: "2026-05-10T15:00:00.000Z",
      existingReminders: [],
    });

    expect(duplicate).toMatchObject({ blocked: true, blockReason: "duplicate" });
    expect(past).toMatchObject({ blocked: true, blockReason: "past" });
  });

  it("projects only future unsent reminders as upcoming", () => {
    const state = projectUpcomingReminderState([
      { id: "future", status: "pending", remind_at: "2026-05-10T17:00:00.000Z" },
      { id: "sent", status: "sent", remind_at: "2026-05-10T18:00:00.000Z" },
      { id: "missed", status: "missed", remind_at: "2026-05-10T19:00:00.000Z" },
    ], { now: "2026-05-10T16:00:00.000Z" });

    expect(state).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 1,
      nextReminderAt: "2026-05-10T17:00:00.000Z",
    });
  });

  it("projects the earliest pending future reminder when an item has multiple reminders", () => {
    const state = projectUpcomingReminderState([
      { id: "later", status: "pending", remind_at: "2026-05-10T18:00:00.000Z" },
      { id: "already-fired", status: "sent", remind_at: "2026-05-10T16:30:00.000Z" },
      { id: "earliest", status: "pending", remind_at: "2026-05-10T17:00:00.000Z" },
      { id: "past-pending", status: "pending", remind_at: "2026-05-10T15:59:00.000Z" },
    ], { now: "2026-05-10T16:00:00.000Z" });

    expect(state).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 2,
      nextReminderAt: "2026-05-10T17:00:00.000Z",
    });
  });

  it("classifies due rows inside and outside the missed-reminder grace window", () => {
    expect(computeReminderState({
      remindAt: "2026-05-10T10:30:00.000Z",
      now: "2026-05-10T16:00:00.000Z",
    })).toBe("due");
    expect(computeReminderState({
      remindAt: "2026-05-10T09:59:59.999Z",
      now: "2026-05-10T16:00:00.000Z",
    })).toBe("missed");
  });
});
