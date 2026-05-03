import { describe, expect, it } from "vitest";
import { buildReschedulePayload } from "./useCalendarQuickActions";

describe("useCalendarQuickActions helpers", () => {
  it("builds drag-drop reschedule payloads from the shifted event date and original time", () => {
    const event = {
      id: "event-drag-1",
      etag: '"etag-drag-1"',
      title: "Move me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
      location: "Office",
      description: "Notes",
    };
    const shiftedEvent = {
      ...event,
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
    };

    expect(buildReschedulePayload(event, shiftedEvent)).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Move me",
      allDay: false,
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      etag: '"etag-drag-1"',
      scope: undefined,
      recurringEventId: undefined,
      originalStartTime: undefined,
    });
  });
});
