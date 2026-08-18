import { describe, expect, it } from "vitest";
import {
  calculateNextRouteCheck,
  calculateTimeToLeave,
  normalizeTimeToLeaveRequest,
} from "./time-to-leave-model.ts";

const baseRequest = {
  reminderKind: "time_to_leave" as const,
  sourceType: "calendar_event" as const,
  sourceAccountId: "gmail-1",
  sourceCalendarId: "primary",
  sourceItemId: "event-1",
  eventStart: "2026-08-18T20:00:00.000Z",
  eventLocation: "  500 Pine St, Seattle, WA  ",
};

describe("Time to Leave model", () => {
  it("normalizes location text and defaults the arrival buffer to 15 minutes", () => {
    expect(normalizeTimeToLeaveRequest(
      baseRequest,
      "2026-08-18T16:00:00.000Z",
    )).toMatchObject({
      eventLocation: "500 Pine St, Seattle, WA",
      arrivalBufferMinutes: 15,
    });
  });

  it("requires exact calendar source identity for dynamic reminders", () => {
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, sourceAccountId: null },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/calendar account/i);
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, sourceCalendarId: null },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/calendar account and calendar/i);
  });

  it.each([-1, 121, 1.5, Number.NaN])("rejects invalid arrival buffer %s", (arrivalBufferMinutes) => {
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, arrivalBufferMinutes },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/integer from 0 through 120/i);
  });

  it.each([
    ["blank", ""],
    ["URL-only", "https://meet.example.test/room"],
    ["scheme-less URL-only", "meet.google.com/room"],
    ["Zoom-only", "Zoom Meeting"],
  ])("rejects %s locations", (_label, eventLocation) => {
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, eventLocation },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/physical event location|Add a physical/i);
  });

  it("rejects all-day, already-started, unsupported-source, and unscoped recurring inputs", () => {
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, isAllDay: true },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/timed calendar event/i);
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, eventStart: "2026-08-18T15:00:00.000Z" },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/has not started/i);
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, sourceType: "todoist_task" as never },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/only for calendar events/i);
    expect(() => normalizeTimeToLeaveRequest(
      { ...baseRequest, isRecurring: true },
      "2026-08-18T16:00:00.000Z",
    )).toThrow(/one recurring event occurrence/i);
  });

  it("calculates leave time from event start, buffer, and traffic duration", () => {
    expect(calculateTimeToLeave("2026-08-18T20:00:00.000Z", 15, 1_800))
      .toBe("2026-08-18T19:15:00.000Z");
  });

  it.each([
    ["more than three hours", "2026-08-18T14:00:00.000Z", "2026-08-18T16:00:00.000Z"],
    ["exactly three hours", "2026-08-18T16:00:00.000Z", "2026-08-18T16:15:00.000Z"],
    ["between three hours and one hour", "2026-08-18T17:30:00.000Z", "2026-08-18T17:45:00.000Z"],
    ["within the final hour", "2026-08-18T18:30:00.000Z", "2026-08-18T18:35:00.000Z"],
    ["near event start", "2026-08-18T19:58:00.000Z", "2026-08-18T20:00:00.000Z"],
  ])("uses the bounded cadence %s", (_label, now, expected) => {
    expect(calculateNextRouteCheck({
      now,
      eventStart: "2026-08-18T20:00:00.000Z",
      estimatedDeparture: "2026-08-18T19:00:00.000Z",
    })).toBe(expected);
  });

  it("stops scheduling checks at event start", () => {
    expect(calculateNextRouteCheck({
      now: "2026-08-18T20:00:00.000Z",
      eventStart: "2026-08-18T20:00:00.000Z",
      estimatedDeparture: "2026-08-18T19:00:00.000Z",
    })).toBeNull();
  });
});
