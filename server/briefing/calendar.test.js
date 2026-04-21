import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildGoogleRecurrenceRules,
  extractStructuredRecurrence,
  getNextWeekRange,
  normalizeGoogleCalendarLink,
  normalizeGoogleEvent,
} from "./calendar.js";

describe("getNextWeekRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns next Sun–Sat when today is Thursday Apr 3 2026", () => {
    vi.useFakeTimers();
    // Thu Apr 3 2026, 10:00 AM Pacific (UTC-7)
    vi.setSystemTime(new Date("2026-04-03T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    expect(startDate.getDay()).toBe(0); // Sunday
    expect(startDate.getDate()).toBe(5); // Apr 5
    expect(endDate.getDay()).toBe(6); // Saturday
    expect(endDate.getDate()).toBe(11); // Apr 11
  });

  it("returns next Sun–Sat when today is Saturday Apr 4 2026", () => {
    vi.useFakeTimers();
    // Sat Apr 4 2026, 10:00 AM Pacific
    vi.setSystemTime(new Date("2026-04-04T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    expect(startDate.getDay()).toBe(0); // Sunday
    expect(startDate.getDate()).toBe(5); // Apr 5 (tomorrow)
    expect(endDate.getDay()).toBe(6); // Saturday
    expect(endDate.getDate()).toBe(11); // Apr 11
  });

  it("returns next Sun–Sat when today is Sunday Apr 5 2026", () => {
    vi.useFakeTimers();
    // Sun Apr 5 2026, 10:00 AM Pacific
    vi.setSystemTime(new Date("2026-04-05T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    // Next week starts Apr 12 (next Sunday)
    expect(startDate.getDate()).toBe(12);
    expect(endDate.getDate()).toBe(18);
  });

  it("startDate and endDate are correct Pacific midnight boundaries regardless of server timezone", () => {
    vi.useFakeTimers();
    // Thu Apr 3 2026 — Pacific is UTC-7 (PDT)
    // Next Sunday is Apr 5, midnight Pacific = 07:00 UTC
    // Next Saturday is Apr 11, end-of-day Pacific = Apr 12 06:59:59.999 UTC
    vi.setSystemTime(new Date("2026-04-03T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    // ISO string must show midnight Pacific as 07:00Z (UTC-7 offset)
    expect(startDate.toISOString()).toBe("2026-04-05T07:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-04-12T06:59:59.999Z");
  });
});

describe("normalizeGoogleCalendarLink", () => {
  it("adds authuser for Google Calendar links", () => {
    const result = normalizeGoogleCalendarLink(
      "https://calendar.google.com/calendar/u/0/r/eventedit/abc123",
      "me@example.com",
    );
    expect(result).toContain("authuser=me%40example.com");
  });

  it("normalizes generic Google event redirect links to calendar eventedit URLs", () => {
    const result = normalizeGoogleCalendarLink(
      "https://www.google.com/calendar/event?eid=abc123",
      "me@example.com",
    );
    expect(result).toContain("https://calendar.google.com/calendar/u/0/r/eventedit/abc123");
    expect(result).toContain("authuser=me%40example.com");
  });

  it("leaves non-Google links untouched", () => {
    expect(normalizeGoogleCalendarLink("https://example.com/event/123", "me@example.com"))
      .toBe("https://example.com/event/123");
  });
});

describe("buildGoogleRecurrenceRules", () => {
  it("builds a weekly recurrence rule with weekdays", () => {
    expect(buildGoogleRecurrenceRules(
      {
        frequency: "weekly",
        weekdays: ["monday", "wed", "FR"],
        ends: { type: "never" },
      },
      {
        allDay: false,
        startDate: "2026-04-20",
        startTime: "03:00",
      },
    )).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR"]);
  });

  it("builds a monthly recurrence rule with an inclusive until date", () => {
    expect(buildGoogleRecurrenceRules(
      {
        frequency: "monthly",
        interval: 2,
        ends: { type: "onDate", untilDate: "2026-08-20" },
      },
      {
        allDay: false,
        startDate: "2026-04-20",
        startTime: "03:00",
      },
    )).toEqual(["RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=20;UNTIL=20260820T100000Z"]);
  });
});

describe("extractStructuredRecurrence", () => {
  it("parses a weekly RRULE into structured recurrence metadata", () => {
    expect(extractStructuredRecurrence([
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;UNTIL=20260820T100000Z",
    ])).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "WE"],
      monthDay: null,
      month: null,
      ends: { type: "onDate", untilDate: "2026-08-20" },
    });
  });
});

describe("normalizeGoogleEvent", () => {
  it("includes recurring identity and parsed recurrence metadata", () => {
    const event = normalizeGoogleEvent({
      account: {
        id: "acct-1",
        email: "me@example.com",
        label: "Google",
        color: "#4285f4",
      },
      calendar: {
        id: "primary",
        summary: "Primary",
        writable: true,
        backgroundColor: "#4285f4",
      },
      event: {
        id: "series-1",
        summary: "Weekly work",
        htmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/series-1",
        start: { dateTime: "2026-04-20T03:00:00-07:00" },
        end: { dateTime: "2026-04-20T08:00:00-07:00" },
        recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"],
      },
    });

    expect(event.isRecurring).toBe(true);
    expect(event.recurringEventId).toBe("series-1");
    expect(event.recurringKind).toBe("series");
    expect(event.recurrence).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO"],
      monthDay: null,
      month: null,
      ends: { type: "never" },
      rules: ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"],
    });
  });
});
