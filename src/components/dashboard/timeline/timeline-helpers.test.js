import { describe, expect, it } from "vitest";
import {
  buildTimelineGroups,
  resolveTimelineNowMarkerTop,
  shouldHoldPartialTimeline,
} from "./timeline-helpers.js";

function row(offsetTop, offsetHeight) {
  return { offsetTop, offsetHeight };
}

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

  it("insets the now marker from the top edge before the first future row", () => {
    expect(resolveTimelineNowMarkerTop({
      items: [{ kind: "deadline", dueAtMs: 300 }],
      now: 100,
      rows: [row(40, 28)],
    })).toBe(14);
  });

  it("places the now marker proportionally inside a live event", () => {
    expect(resolveTimelineNowMarkerTop({
      items: [{ kind: "event", startMs: 100, endMs: 300 }],
      now: 200,
      rows: [row(40, 80)],
    })).toBe(80);
  });

  it("keeps the now marker from tracking through all-day events", () => {
    expect(resolveTimelineNowMarkerTop({
      items: [
        { kind: "event", startMs: 0, endMs: 1000, data: { allDay: true } },
        { kind: "deadline", dueAtMs: 1200 },
      ],
      now: 500,
      rows: [row(40, 80), row(140, 40)],
    })).toBe(122);
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
  });
});
