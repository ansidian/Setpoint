import { describe, expect, it } from "vitest";

import {
  buildCloneEventPayload,
  buildColorUpdatePayload,
  buildOptimisticCloneEvent,
  buildOptimisticClipboardPasteEvent,
  buildReschedulePayload,
} from "./calendarQuickActionModel";
import { epochFromLa } from "../../inbox/helpers";

describe("calendarQuickActionModel builders", () => {
  it("builds drag-drop reschedule payloads from the source date plus deltaDays and original time", () => {
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

    expect(buildReschedulePayload(event, 1)).toEqual({
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

  it("lands a late-evening drag on the correct calendar day across spring-forward DST", () => {
    // Sat Mar 7 2026 23:00 PT (PST, UTC-8) → drag one day to Sun Mar 8.
    // Spring-forward is 02:00 Mar 8; a fixed 86_400_000ms shift would push the
    // 23:00 instant to 00:00 Mon Mar 9 in Pacific wall-clock, landing the
    // payload on the wrong day. deltaDays arithmetic keeps it on Mar 8.
    const event = {
      id: "event-dst-drag",
      etag: '"etag-dst"',
      title: "Late night",
      accountId: "gmail-main",
      calendarId: "primary",
      // 2026-03-07 23:00 PST == 2026-03-08T07:00Z
      startMs: new Date("2026-03-08T07:00:00.000Z").getTime(),
      endMs: new Date("2026-03-08T07:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
    };

    expect(buildReschedulePayload(event, 1)).toMatchObject({
      startDate: "2026-03-08",
      endDate: "2026-03-08",
      startTime: "23:00",
      endTime: "23:30",
    });
  });

  it("shifts a multi-day all-day reschedule by deltaDays preserving its span", () => {
    const event = {
      id: "event-allday-drag",
      title: "Conference",
      accountId: "gmail-main",
      calendarId: "primary",
      // all-day end is exclusive; 04-20 → 04-23 exclusive == 04-22 inclusive
      startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
      endMs: new Date("2026-04-23T07:00:00.000Z").getTime(),
      allDay: true,
    };

    expect(buildReschedulePayload(event, 5)).toMatchObject({
      startDate: "2026-04-25",
      endDate: "2026-04-27",
      startTime: null,
      endTime: null,
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

  it("computes optimistic clipboard-paste ms from Pacific wall-clock, not the host zone", () => {
    // The paste plan carries Pacific date/time strings; the server interprets
    // them in Pacific. The optimistic event must match. epochFromLa is always
    // anchored to America/Los_Angeles, so this equality holds regardless of the
    // host TZ — and the prior offsetless `new Date(date+"T"+time)` (host-local)
    // would only match it on a Pacific host.
    const item = {
      title: "Pasted lunch",
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: false,
      startDate: "2026-06-15",
      startTime: "12:30",
      endDate: "2026-06-15",
      endTime: "13:30",
    };

    const optimistic = buildOptimisticClipboardPasteEvent(item, 0);
    expect(optimistic.startMs).toBe(epochFromLa(2026, 5, 15, 12, 30));
    expect(optimistic.endMs).toBe(epochFromLa(2026, 5, 15, 13, 30));
  });

  it("anchors optimistic all-day paste bounds to Pacific midnight with an exclusive end", () => {
    const item = {
      title: "Pasted holiday",
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: true,
      startDate: "2026-06-15",
      startTime: null,
      endDate: "2026-06-15",
      endTime: null,
    };

    const optimistic = buildOptimisticClipboardPasteEvent(item, 0);
    expect(optimistic.startMs).toBe(epochFromLa(2026, 5, 15, 0, 0));
    // all-day end is exclusive — next Pacific midnight.
    expect(optimistic.endMs).toBe(epochFromLa(2026, 5, 16, 0, 0));
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
