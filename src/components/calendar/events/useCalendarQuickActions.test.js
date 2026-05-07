import { describe, expect, it } from "vitest";
import {
  buildCloneEventPayload,
  buildColorUpdatePayload,
  buildOptimisticCloneEvent,
  buildReschedulePayload,
} from "./useCalendarQuickActions";

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

  it("builds standalone clone payloads on the target date without recurrence metadata", () => {
    const event = {
      id: "event-copy-1",
      etag: '"etag-copy-1"',
      title: "Copy me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      location: "Office",
      description: "Notes",
      colorId: "7",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Copy me",
      allDay: false,
      startDate: "2026-04-22",
      endDate: "2026-04-22",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      colorId: "7",
    });
  });

  it("uses mapped source color ids when cloning events without explicit overrides", () => {
    const event = {
      id: "event-copy-source-color",
      title: "Copy source color",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      allDay: false,
      colorId: null,
      sourceColorId: "3",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toMatchObject({
      colorId: "3",
    });
  });

  it("preserves all-day spans when cloning onto a target date", () => {
    const event = {
      id: "event-copy-all-day",
      title: "Trip",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
      endMs: new Date("2026-04-23T19:00:00.000Z").getTime(),
      allDay: true,
    };

    expect(buildCloneEventPayload(event, "2026-05-01")).toMatchObject({
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      startTime: null,
      endTime: null,
    });
  });

  it("builds optimistic standalone clone events on the target date", () => {
    const event = {
      id: "event-copy-optimistic",
      title: "Copy optimistic",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      colorId: "7",
    };

    expect(buildOptimisticCloneEvent(event, "2026-04-22")).toMatchObject({
      id: expect.stringMatching(/^optimistic-calendar-copy-event-copy-optimistic-/),
      title: "Copy optimistic",
      startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T17:30:00.000Z").getTime(),
      colorId: "7",
      color: "#46d6db",
      isRecurring: false,
      recurringEventId: null,
      originalStartTime: null,
      passed: false,
    });
  });

  it("builds scoped color payloads for recurring events", () => {
    const event = {
      id: "event-color-1",
      etag: '"etag-color-1"',
      title: "Color me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    };

    expect(buildColorUpdatePayload(event, "11", "following")).toMatchObject({
      accountId: "gmail-main",
      calendarId: "primary",
      colorId: "11",
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    });
  });
});
