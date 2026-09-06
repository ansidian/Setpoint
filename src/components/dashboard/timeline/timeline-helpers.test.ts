import { describe, expect, it } from "vitest";
import {
  buildTimelineGroups,
  buildTodayTomorrowRestGroups, partitionTodayEvents
} from "./timeline-helpers";

describe("timeline helpers", () => {
  it("folds only ended timed events, preserving deadlines and events that still need attention", () => {
    const now = Date.parse("2026-05-11T20:00:00.000Z");
    const ended = { kind: "event", endMs: now - 1, data: { title: "Finished" } };
    const justEnded = { kind: "event", data: { title: "Just ended", endMs: now } };
    const overdue = { kind: "deadline", dueAtMs: now - 3600000, data: { status: "pending" } };
    const live = { kind: "event", startMs: now - 1000, endMs: now + 1000 };
    const upcoming = { kind: "event", startMs: now + 1000, endMs: now + 2000 };
    const allDay = { kind: "event", endMs: now - 1, data: { allDay: true } };
    const unknownEnd = { kind: "event", startMs: now - 3600000 };
    const items = [ended, overdue, justEnded, live, upcoming, allDay, unknownEnd];

    expect(partitionTodayEvents(items, now)).toEqual({
      earlier: [ended, justEnded],
      remaining: [overdue, live, upcoming, allDay, unknownEnd],
    });
  });

  it("keeps an empty today group whenever a timeline filter remains active", () => {
    expect(buildTimelineGroups([], Date.now(), { events: false, deadlines: true })).toEqual([[0, []]]);
    expect(buildTimelineGroups([], Date.now(), { events: true, deadlines: false })).toEqual([[0, []]]);
    expect(buildTimelineGroups([], Date.now(), { events: false, deadlines: false })).toEqual([]);
  });

  it("can clamp dashboard timeline groups to today forward", () => {
    const now = Date.parse("2026-05-11T16:00:00.000Z");
    const yesterday = Date.parse("2026-05-10T18:00:00.000Z");
    const today = Date.parse("2026-05-11T18:00:00.000Z");
    const tomorrow = Date.parse("2026-05-12T18:00:00.000Z");

    const groups = buildTimelineGroups([
      { kind: "deadline", dueAtMs: yesterday },
      { kind: "deadline", dueAtMs: today },
      { kind: "deadline", dueAtMs: tomorrow },
    ], now, { events: true, deadlines: true }, { minDay: 0 });

    expect(groups.map(([day]) => day)).toEqual([0, 1]);
  });

  it("places all-day events before timed items within the same day", () => {
    const now = Date.parse("2026-05-11T07:00:00.000Z"); // midnight Pacific
    const groups = buildTimelineGroups([
      {
        kind: "event",
        startMs: Date.parse("2026-05-11T11:15:00.000Z"), // 4:15 AM Pacific
        data: { title: "Work", allDay: false },
      },
      {
        kind: "event",
        startMs: Date.parse("2026-05-11T12:00:00.000Z"), // synthetic all-day anchor
        data: { title: "Application Processing Begins", allDay: true },
      },
      {
        kind: "event",
        startMs: Date.parse("2026-05-11T12:00:00.000Z"), // 5:00 AM Pacific
        data: { title: "Test event", allDay: false },
      },
    ], now, { events: true, deadlines: true });

    expect(groups[0]![1].map((item) => item.data?.title)).toEqual([
      "Application Processing Begins",
      "Work",
      "Test event",
    ]);
  });

});

describe("buildTodayTomorrowRestGroups", () => {
  const now = Date.parse("2026-05-11T16:00:00.000Z");
  const at = (offsetDays: number, hour = 18) => Date.parse(`2026-05-${String(11 + offsetDays).padStart(2, "0")}T${hour}:00:00.000Z`);
  const filters = { events: true, deadlines: true };

  it("splits items into today, tomorrow, and a rest-of-week count", () => {
    const items = [
      { kind: "event", startMs: at(0), data: {} },
      { kind: "event", startMs: at(1, 17), data: {} },
      { kind: "deadline", dueAtMs: at(1, 23), data: {} },
      { kind: "event", startMs: at(2), data: {} },
      { kind: "deadline", dueAtMs: at(4), data: {} },
    ];
    const result = buildTodayTomorrowRestGroups(items, now, filters);
    expect(result.today).toHaveLength(1);
    expect(result.tomorrow).toHaveLength(2);
    expect(result.tomorrowCount).toEqual({ events: 1, deadlines: 1 });
    expect(result.restCount).toBe(2);
  });

  it("excludes items past this week (bucket > 6) from the rest count", () => {
    const items = [
      { kind: "deadline", dueAtMs: at(6), data: {} },
      { kind: "deadline", dueAtMs: at(9), data: {} },
    ];
    const result = buildTodayTomorrowRestGroups(items, now, filters);
    expect(result.restCount).toBe(1);
  });

  it("exposes the rest-of-week items grouped by day so the disclosure can render them", () => {
    const items = [
      { kind: "event", startMs: at(2), data: {} },
      { kind: "deadline", dueAtMs: at(2, 23), data: {} },
      { kind: "deadline", dueAtMs: at(4), data: {} },
      { kind: "deadline", dueAtMs: at(9), data: {} }, // past this week → excluded
    ];
    const result = buildTodayTomorrowRestGroups(items, now, filters);
    expect(result.rest.map(([day]) => day)).toEqual([2, 4]);
    expect(result.rest[0]![1]).toHaveLength(2);
    expect(result.rest[1]![1]).toHaveLength(1);
    expect(result.restCount).toBe(3);
  });
});
