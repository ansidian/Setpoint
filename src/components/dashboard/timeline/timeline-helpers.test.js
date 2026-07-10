import { describe, expect, it } from "vitest";
import {
  buildTimelineGroups,
  buildTodayTomorrowRestGroups,
  formatNowMarkerLabel,
  percentElapsed,
  resolveTodayNowMarkerIndex,
  shouldHoldPartialTimeline,
} from "./timeline-helpers.js";

describe("timeline helpers", () => {
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

  describe("percentElapsed", () => {
    it("returns the fractional progress through a window", () => {
      expect(percentElapsed(100, 300, 200)).toBe(0.5);
      expect(percentElapsed(0, 1000, 300)).toBe(0.3);
    });
    it("clamps to 0 before the window starts", () => {
      expect(percentElapsed(100, 300, 50)).toBe(0);
      expect(percentElapsed(100, 300, 100)).toBe(0);
    });
    it("clamps to 1 once the window has ended", () => {
      expect(percentElapsed(100, 300, 300)).toBe(1);
      expect(percentElapsed(100, 300, 9999)).toBe(1);
    });
    it("returns 0 for a zero-length or inverted window", () => {
      expect(percentElapsed(300, 300, 300)).toBe(0);
      expect(percentElapsed(300, 100, 200)).toBe(0);
    });
  });

  describe("shouldHoldPartialTimeline", () => {
    it("does not blank the timeline once events are ready", () => {
      expect(shouldHoldPartialTimeline({ eventLoadingState: "ready", filtersEvents: true })).toBe(false);
    });

    it("keeps showing seeded groups while a warm refresh is in flight (the blank-flash bug)", () => {
      // 'refreshing' means seeded events are already on screen; holding back to
      // skeletons here is the regression that makes the timeline flash blank on
      // every SSE refresh and on returning to the dashboard.
      expect(shouldHoldPartialTimeline({ eventLoadingState: "refreshing", filtersEvents: true })).toBe(false);
    });

    it("blanks to skeletons only on a cold load with no seeded events", () => {
      expect(shouldHoldPartialTimeline({ eventLoadingState: "empty_loading", filtersEvents: true })).toBe(true);
    });

    it("does not hold for an events-only cold load when the events filter is off", () => {
      expect(shouldHoldPartialTimeline({ eventLoadingState: "empty_loading", filtersEvents: false })).toBe(false);
    });

    it("holds while filtered deadlines are still loading", () => {
      expect(shouldHoldPartialTimeline({
        eventLoadingState: "ready",
        filtersEvents: true,
        filtersDeadlines: true,
        deadlinesLoading: true,
        hasDeadlineRows: false,
      })).toBe(true);
    });

    it("shows the honest empty state once deadline loading settles", () => {
      expect(shouldHoldPartialTimeline({
        eventLoadingState: "ready",
        filtersEvents: true,
        filtersDeadlines: true,
        deadlinesLoading: false,
        hasDeadlineRows: false,
      })).toBe(false);
    });
  });

  describe("formatNowMarkerLabel", () => {
    it("formats the in-card marker as 'NOW H:MM · N% elapsed' without a meridiem", () => {
      const now = Date.parse("2026-03-06T21:18:00.000Z"); // 1:18 PM Pacific
      expect(formatNowMarkerLabel(now, 0.3)).toBe("NOW 1:18 · 30% elapsed");
    });
    it("rounds the percent to a whole number", () => {
      const now = Date.parse("2026-03-06T21:18:00.000Z");
      expect(formatNowMarkerLabel(now, 0.666)).toBe("NOW 1:18 · 67% elapsed");
    });
  });
});

describe("buildTodayTomorrowRestGroups", () => {
  const now = Date.parse("2026-05-11T16:00:00.000Z");
  const at = (offsetDays, hour = 18) => Date.parse(`2026-05-${String(11 + offsetDays).padStart(2, "0")}T${hour}:00:00.000Z`);
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

  it("returns empty tomorrow/zero rest when only today has items", () => {
    const items = [{ kind: "event", startMs: at(0), data: {} }];
    const result = buildTodayTomorrowRestGroups(items, now, filters);
    expect(result.today).toHaveLength(1);
    expect(result.tomorrow).toEqual([]);
    expect(result.tomorrowCount).toEqual({ events: 0, deadlines: 0 });
    expect(result.restCount).toBe(0);
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
    expect(result.rest[0][1]).toHaveLength(2);
    expect(result.rest[1][1]).toHaveLength(1);
    expect(result.restCount).toBe(3);
  });
});

describe("resolveTodayNowMarkerIndex", () => {
  const now = Date.parse("2026-05-11T20:00:00.000Z");
  const ev = (startISO, endISO) => {
    const startMs = Date.parse(startISO);
    const endMs = Date.parse(endISO);
    return { kind: "event", startMs, endMs, data: { id: startISO, title: "e", startMs, endMs } };
  };

  it("places the focus-window marker between a finished event and the next upcoming one", () => {
    const items = [
      ev("2026-05-11T17:00:00.000Z", "2026-05-11T18:00:00.000Z"), // past
      ev("2026-05-11T22:00:00.000Z", "2026-05-11T23:00:00.000Z"), // future
    ];
    expect(resolveTodayNowMarkerIndex(items, now)).toBe(1);
  });

  it("returns null while an event is live so the in-card progress line owns the marker", () => {
    const items = [ev("2026-05-11T19:30:00.000Z", "2026-05-11T20:30:00.000Z")]; // live at 20:00
    expect(resolveTodayNowMarkerIndex(items, now)).toBeNull();
  });

  it("returns null when the day has no items", () => {
    expect(resolveTodayNowMarkerIndex([], now)).toBeNull();
  });

  it("anchors the marker at the top before the first upcoming item", () => {
    const items = [ev("2026-05-11T22:00:00.000Z", "2026-05-11T23:00:00.000Z")];
    expect(resolveTodayNowMarkerIndex(items, now)).toBe(0);
  });

  it("anchors the marker after the last item once the day is fully past", () => {
    const items = [
      ev("2026-05-11T17:00:00.000Z", "2026-05-11T18:00:00.000Z"),
      ev("2026-05-11T18:30:00.000Z", "2026-05-11T19:00:00.000Z"),
    ];
    expect(resolveTodayNowMarkerIndex(items, now)).toBe(2);
  });

  const allDayEv = (startISO, endISO) => ({
    kind: "event",
    startMs: Date.parse(startISO),
    endMs: Date.parse(endISO),
    data: { allDay: true, title: "Holiday" },
  });

  it("always sits below an all-day event, even before the all-day's nominal time (early-morning)", () => {
    // 'now' is BEFORE the all-day's noon-UTC anchor — the pre-~5am-Pacific window.
    const earlyNow = Date.parse("2026-05-11T13:00:00.000Z");
    const items = [
      allDayEv("2026-05-11T19:00:00.000Z", "2026-05-12T19:00:00.000Z"), // sorts first
      ev("2026-05-11T22:00:00.000Z", "2026-05-11T23:00:00.000Z"), // genuinely future
    ];
    // Marker after the all-day (index 1), never above it (index 0).
    expect(resolveTodayNowMarkerIndex(items, earlyNow)).toBe(1);
  });

  it("still breaks at a future TIMED item — an all-day does not force everything past", () => {
    const earlyNow = Date.parse("2026-05-11T13:00:00.000Z");
    const items = [
      allDayEv("2026-05-11T19:00:00.000Z", "2026-05-12T19:00:00.000Z"),
      ev("2026-05-11T20:00:00.000Z", "2026-05-11T21:00:00.000Z"), // future timed
      ev("2026-05-11T22:00:00.000Z", "2026-05-11T23:00:00.000Z"), // future timed
    ];
    // All-day counts (index 1); the marker still stops before the future timed items.
    expect(resolveTodayNowMarkerIndex(items, earlyNow)).toBe(1);
  });
});
