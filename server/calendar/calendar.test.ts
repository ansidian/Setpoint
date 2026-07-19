import { describe, it, expect, vi, afterEach } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getAuthorizedAccount: vi.fn(),
  listCalendarsForAccount: vi.fn(),
  googleCalendarFetch: vi.fn(),
}));

vi.mock("./calendar-google-client", async (importOriginal) => ({
  ...(await importOriginal()),
  getAuthorizedAccount: clientMocks.getAuthorizedAccount,
  listCalendarsForAccount: clientMocks.listCalendarsForAccount,
  googleCalendarFetch: clientMocks.googleCalendarFetch,
}));

import {
  buildGoogleRecurrenceRules,
  DASHBOARD_CALENDAR_TZ,
  extractStructuredRecurrence,
  fetchCalendar,
  getNextWeekRange,
  markCalendarConflicts,
  normalizeGoogleCalendarLink,
  normalizeGoogleEvent,
} from "./calendar.ts";

function pacificDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

describe("markCalendarConflicts", () => {
  type ConflictEvent = {
    id: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    flag?: "Conflict";
  };
  const ev = (id: string, startMs: number, endMs: number, allDay = false): ConflictEvent => ({ id, startMs, endMs, allDay });
  const flagged = (events: ConflictEvent[]) => events.filter((e) => e.flag === "Conflict").map((e) => e.id).sort();

  it("flags both events when two timed events strictly overlap", () => {
    const events = [ev("a", 0, 100), ev("b", 50, 150)];
    markCalendarConflicts(events);
    expect(flagged(events)).toEqual(["a", "b"]);
  });

  it("does not flag events that merely touch at a boundary", () => {
    const events = [ev("a", 0, 100), ev("b", 100, 200)];
    markCalendarConflicts(events);
    expect(flagged(events)).toEqual([]);
  });

  it("flags a nested event and its container", () => {
    const events = [ev("outer", 0, 1000), ev("inner", 200, 300)];
    markCalendarConflicts(events);
    expect(flagged(events)).toEqual(["inner", "outer"]);
  });

  it("never flags all-day events even when they span timed events", () => {
    const events = [ev("allday", 0, 100000, true), ev("a", 10, 20), ev("b", 30, 40)];
    markCalendarConflicts(events);
    expect(flagged(events)).toEqual([]);
  });

  it("matches the brute-force all-pairs algorithm on randomized inputs", () => {
    // Deterministic LCG so the property check is reproducible.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bruteForce = (events: ConflictEvent[]) => {
      const flags = events.map(() => false);
      for (let i = 0; i < events.length; i += 1) {
        if (events[i]!.allDay) continue;
        for (let j = i + 1; j < events.length; j += 1) {
          if (events[j]!.allDay) continue;
          if (events[i]!.startMs < events[j]!.endMs && events[j]!.startMs < events[i]!.endMs) {
            flags[i] = true;
            flags[j] = true;
          }
        }
      }
      return flags;
    };

    for (let trial = 0; trial < 40; trial += 1) {
      const events = Array.from({ length: 60 }, (_, i) => {
        const start = Math.floor(rand() * 500);
        const duration = 1 + Math.floor(rand() * 50); // strictly positive
        return ev(`e${i}`, start, start + duration, rand() < 0.15);
      });
      const expected = bruteForce(events);
      markCalendarConflicts(events);
      const actual = events.map((e) => e.flag === "Conflict");
      expect(actual).toEqual(expected);
    }
  });
});

describe("fetchCalendar fan-out", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const range = {
    startDate: new Date("2026-04-20T07:00:00.000Z"),
    endDate: new Date("2026-04-21T06:59:59.999Z"),
  };

  function eventsResponse(items: unknown[]): Response {
    return { json: async () => ({ items }) } as Response;
  }

  function timedItem(id: string) {
    return {
      id,
      summary: id,
      start: { dateTime: "2026-04-20T09:00:00-07:00" },
      end: { dateTime: "2026-04-20T09:30:00-07:00" },
    };
  }

  it("fetches every calendar across every account and merges the results", async () => {
    clientMocks.getAuthorizedAccount.mockResolvedValue({ accessToken: "t" });
    clientMocks.listCalendarsForAccount.mockResolvedValue([
      { id: "primary", summary: "Primary" },
      { id: "work", summary: "Work" },
    ]);
    clientMocks.googleCalendarFetch.mockImplementation(async (_auth: unknown, path: string) =>
      eventsResponse([timedItem(path)]));

    const events = await fetchCalendar(
      [{ id: "a", email: "a@example.com" }, { id: "b", email: "b@example.com" }],
      range,
    );

    // 2 accounts × 2 calendars = 4 independent event fetches.
    expect(clientMocks.googleCalendarFetch).toHaveBeenCalledTimes(4);
    expect(events).toHaveLength(4);
  });

  it("degrades gracefully when one calendar fetch fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    clientMocks.getAuthorizedAccount.mockResolvedValue({ accessToken: "t" });
    clientMocks.listCalendarsForAccount.mockResolvedValue([
      { id: "primary", summary: "Primary" },
      { id: "broken", summary: "Broken" },
    ]);
    clientMocks.googleCalendarFetch.mockImplementation(async (_auth: unknown, path: string) => {
      if (path.includes("broken")) {
        const err = new Error("nope") as Error & { code: string };
        err.code = "calendar_google_error";
        throw err;
      }
      return eventsResponse([timedItem(path)]);
    });

    const events = await fetchCalendar([{ id: "a", email: "a@example.com" }], range);

    // The failing calendar is swallowed by its per-calendar .catch; the healthy
    // calendar still populates the response.
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toContain("primary");
  });
});

describe("getNextWeekRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns next Sun–Sat when today is Thursday Apr 3 2026", () => {
    vi.useFakeTimers();
    // Thu Apr 3 2026, 10:00 AM Pacific (UTC-7)
    vi.setSystemTime(new Date("2026-04-03T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    expect(pacificDateKey(startDate)).toBe("2026-04-05");
    expect(pacificDateKey(endDate)).toBe("2026-04-11");
  });

  it("returns next Sun–Sat when today is Saturday Apr 4 2026", () => {
    vi.useFakeTimers();
    // Sat Apr 4 2026, 10:00 AM Pacific
    vi.setSystemTime(new Date("2026-04-04T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    expect(pacificDateKey(startDate)).toBe("2026-04-05");
    expect(pacificDateKey(endDate)).toBe("2026-04-11");
  });

  it("returns next Sun–Sat when today is Sunday Apr 5 2026", () => {
    vi.useFakeTimers();
    // Sun Apr 5 2026, 10:00 AM Pacific
    vi.setSystemTime(new Date("2026-04-05T17:00:00Z"));
    const { startDate, endDate } = getNextWeekRange();
    // Next week starts Apr 12 (next Sunday)
    expect(pacificDateKey(startDate)).toBe("2026-04-12");
    expect(pacificDateKey(endDate)).toBe("2026-04-18");
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

  it("uses explicit Google event color before calendar source color", () => {
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
        id: "event-1",
        summary: "Office",
        colorId: "10",
        start: { dateTime: "2026-04-20T09:00:00-07:00" },
        end: { dateTime: "2026-04-20T09:30:00-07:00" },
      },
    });

    expect(event.colorId).toBe("10");
    expect(event.color).toBe("#51b749");
    expect(event.sourceColor).toBe("#4285f4");
  });

  it("prefers the calendar background color over the account color for inherited source colors", () => {
    const event = normalizeGoogleEvent({
      account: {
        id: "acct-1",
        email: "me@example.com",
        label: "Google",
        color: "#4285f4",
      },
      calendar: {
        id: "work",
        summary: "Work",
        writable: true,
        backgroundColor: "#7a367a",
      },
      event: {
        id: "event-source-color",
        summary: "Office",
        start: { dateTime: "2026-04-20T09:00:00-07:00" },
        end: { dateTime: "2026-04-20T09:30:00-07:00" },
      },
    });

    expect(event.colorId).toBeNull();
    expect(event.sourceColorId).toBe("3");
    expect(event.color).toBe("#dbadff");
    expect(event.sourceColor).toBe("#7a367a");
  });

  it("preserves birthday event type metadata and marks birthdays read-only", () => {
    const event = normalizeGoogleEvent({
      account: {
        id: "acct-1",
        email: "me@example.com",
        label: "Google",
        color: "#4285f4",
      },
      calendar: {
        id: "primary",
        summary: "Personal",
        writable: true,
        backgroundColor: "#4285f4",
      },
      event: {
        id: "birthday-1_20260522",
        summary: "Maya's Birthday",
        eventType: "birthday",
        birthdayProperties: {
          type: "birthday",
          contact: "people/c12345",
        },
        start: { date: "2026-05-22" },
        end: { date: "2026-05-23" },
        recurringEventId: "birthday-1",
        originalStartTime: { date: "2026-05-22" },
      },
    });

    expect(event.eventType).toBe("birthday");
    expect(event.birthdayProperties).toEqual({
      type: "birthday",
      customTypeName: "",
      contact: "people/c12345",
    });
    expect(event.source).toBe("Birthdays");
    expect(event.calendarName).toBe("Birthdays");
    expect(event.calendarId).toBe("primary");
    expect(event.sourceColor).toBe("#ff887c");
    expect(event.sourceColorId).toBe("4");
    expect(event.color).toBe("#ff887c");
    expect(event.writable).toBe(false);
    expect(event.readOnlyReason).toBe("birthday");
  });
});
