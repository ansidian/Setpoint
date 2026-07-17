import { describe, expect, it } from "vitest";
import {
  buildGoogleRecurrenceRules,
  extractStructuredRecurrence,
} from "./calendar.ts";
import type { CalendarRecurrenceInput } from "../../shared/types/calendar.ts";

function roundTrip(
  input: CalendarRecurrenceInput,
  timing: { allDay: boolean; startDate: string; startTime?: string },
) {
  return extractStructuredRecurrence(buildGoogleRecurrenceRules(input, timing));
}

const timedTiming = { allDay: false, startDate: "2026-04-20", startTime: "10:00" };

describe("recurrence round-trip: build → extract → equality", () => {
  it("round-trips a weekly rule with weekday aliases normalized to RRULE tokens", () => {
    expect(roundTrip(
      { frequency: "weekly", interval: 2, weekdays: ["monday", "wed", "FR"], ends: { type: "never" } },
      timedTiming,
    )).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO", "WE", "FR"],
      monthDay: null,
      month: null,
      ends: { type: "never" },
    });
  });

  it("round-trips a daily rule that ends after a count", () => {
    expect(roundTrip(
      { frequency: "daily", ends: { type: "afterCount", count: 8 } },
      timedTiming,
    )).toEqual({
      frequency: "daily",
      interval: 1,
      weekdays: [],
      monthDay: null,
      month: null,
      ends: { type: "afterCount", count: 8 },
    });
  });

  it("round-trips a monthly rule keeping the explicit month day", () => {
    expect(roundTrip(
      { frequency: "monthly", monthDay: 15, ends: { type: "never" } },
      timedTiming,
    )).toEqual(expect.objectContaining({
      frequency: "monthly",
      monthDay: 15,
      month: null,
    }));
  });

  it("round-trips a yearly rule keeping month and month day", () => {
    expect(roundTrip(
      { frequency: "yearly", month: 7, monthDay: 4, ends: { type: "never" } },
      timedTiming,
    )).toEqual(expect.objectContaining({
      frequency: "yearly",
      month: 7,
      monthDay: 4,
    }));
  });
});

describe("recurrence round-trip: UNTIL across timezones (D-CAL-9 / T-3)", () => {
  it("serializes a PDT (summer, UTC-7) until date with the event start time in UTC", () => {
    const rules = buildGoogleRecurrenceRules(
      { frequency: "daily", ends: { type: "onDate", untilDate: "2026-08-20" } },
      { allDay: false, startDate: "2026-08-01", startTime: "10:00" },
    );
    expect(rules).toEqual(["RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260820T170000Z"]);
    expect(extractStructuredRecurrence(rules)!.ends).toEqual({ type: "onDate", untilDate: "2026-08-20" });
  });

  it("serializes a PST (winter, UTC-8) until date with the event start time in UTC", () => {
    const rules = buildGoogleRecurrenceRules(
      { frequency: "daily", ends: { type: "onDate", untilDate: "2026-01-20" } },
      { allDay: false, startDate: "2026-01-05", startTime: "10:00" },
    );
    expect(rules).toEqual(["RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260120T180000Z"]);
    expect(extractStructuredRecurrence(rules)!.ends).toEqual({ type: "onDate", untilDate: "2026-01-20" });
  });

  it("keeps the Pacific until date when a late-evening start pushes UNTIL past UTC midnight", () => {
    const rules = buildGoogleRecurrenceRules(
      { frequency: "weekly", weekdays: ["TH"], ends: { type: "onDate", untilDate: "2026-08-20" } },
      { allDay: false, startDate: "2026-08-06", startTime: "23:30" },
    );
    // 23:30 PDT on Aug 20 is 06:30Z on Aug 21 — the UTC date is one day ahead.
    expect(rules).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;UNTIL=20260821T063000Z"]);
    expect(extractStructuredRecurrence(rules)!.ends).toEqual({ type: "onDate", untilDate: "2026-08-20" });
  });

  it("uses the compact date-only UNTIL for all-day events and round-trips it", () => {
    const rules = buildGoogleRecurrenceRules(
      { frequency: "weekly", weekdays: ["MO"], ends: { type: "onDate", untilDate: "2026-08-20" } },
      { allDay: true, startDate: "2026-08-03" },
    );
    expect(rules).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20260820"]);
    expect(extractStructuredRecurrence(rules)!.ends).toEqual({ type: "onDate", untilDate: "2026-08-20" });
  });

  it("round-trips an until date on the spring-forward day even for a nonexistent local time", () => {
    // 02:30 on Mar 8 2026 does not exist in America/Los_Angeles (clocks jump 2 → 3).
    const rules = buildGoogleRecurrenceRules(
      { frequency: "daily", ends: { type: "onDate", untilDate: "2026-03-08" } },
      { allDay: false, startDate: "2026-03-01", startTime: "02:30" },
    );
    expect(extractStructuredRecurrence(rules)!.ends).toEqual({ type: "onDate", untilDate: "2026-03-08" });
  });
});
