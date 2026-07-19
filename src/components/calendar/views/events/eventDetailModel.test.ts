import { describe, expect, it } from "vitest";
import { orderPlanningItems } from "./eventsPlanningModel.ts";
import {
  calendarActionUrl,
  compactEventTimeRange,
  eventAccent,
  eventSubtitle,
  getDefaultSelectedItemId,
  isEditableEvent,
  orderDetailEvents,
  sanitizeEventDisplayTitle,
  specialEventLabel,
} from "./eventDetailModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

function event(overrides: CalendarItemLike & { id: string; title: string; start: string; end?: string }): CalendarItemLike {
  return {
    ...overrides,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end || overrides.start).getTime(),
    allDay: !!overrides.allDay,
  };
}

function deadline(overrides: CalendarItemLike & { id: string; title: string; due_date: string }): CalendarItemLike {
  return {
    ...overrides,
    due_time: overrides.due_time || null,
    status: overrides.status || "incomplete",
  };
}

describe("event detail model", () => {
  it("orders event-only details all-day first and delegates mixed planning order", () => {
    const allDay = event({ id: "all-day", title: "All day", start: "2026-05-12T07:00:00Z", allDay: true });
    const early = event({ id: "early", title: "Early", start: "2026-05-12T08:00:00Z" });
    const late = event({ id: "late", title: "Late", start: "2026-05-12T20:00:00Z" });
    expect(orderDetailEvents([late, early, allDay]).map((item) => item.id)).toEqual(["all-day", "early", "late"]);
    expect(getDefaultSelectedItemId([late, early, allDay])).toBe("all-day");

    const active = deadline({ id: "active", title: "Active", due_date: "2026-05-12", due_time: "5pm" });
    const complete = deadline({ id: "complete", title: "Complete", due_date: "2026-05-12", status: "complete" });
    const mixed = [complete, active, late, allDay];
    expect(orderDetailEvents(mixed)).toEqual(orderPlanningItems(mixed));
  });

  it("preserves input order for deadline items tied on bucket, time, and title", () => {
    const first = deadline({ id: "a", title: "Same", due_date: "2026-05-12", due_time: "5pm" });
    const second = deadline({ id: "b", title: "Same", due_date: "2026-05-12", due_time: "5pm" });

    expect(orderDetailEvents([first, second]).map((item) => item.id)).toEqual(["a", "b"]);
    expect(orderDetailEvents([second, first]).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("projects title, time, attendee, and editability rules without rendering", () => {
    const ev = event({
      id: "event-1",
      title: "(ZOOM) Design review",
      start: "2026-04-19T17:50:00.000Z",
      end: "2026-04-19T19:05:00.000Z",
      attendees: ["Ava", "Ben", "Cam", "Dev"],
      writable: true,
    });

    expect(sanitizeEventDisplayTitle(ev.title)).toBe("Design review");
    expect(compactEventTimeRange(ev)).toBe("10:50 AM-12:05 PM");
    expect(eventSubtitle(ev)).toBe("with Ava, Ben, Cam +1");
    expect(isEditableEvent(ev)).toBe(true);
  });

  it("keeps Google birthdays read-only and source-colored", () => {
    const birthday = event({
      id: "birthday-1_20260522",
      title: "Maya's birthday",
      start: "2026-05-22T19:00:00.000Z",
      end: "2026-05-23T19:00:00.000Z",
      allDay: true,
      eventType: "birthday",
      birthdayProperties: { type: "birthday", contact: "people/c12345" },
      color: "#5484ed",
      openUrl: "https://calendar.google.com/calendar/u/0/r/eventedit/birthday-1",
      writable: false,
    });

    expect(specialEventLabel(birthday)).toBe("Birthday");
    expect(calendarActionUrl(birthday)).toBeNull();
    expect(eventAccent(birthday)).toBe("#5484ed");
    expect(isEditableEvent(birthday)).toBe(false);
  });
});
