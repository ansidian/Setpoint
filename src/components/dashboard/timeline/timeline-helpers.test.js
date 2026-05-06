import { describe, expect, it } from "vitest";
import {
  buildTimelineGroups,
  resolveTimelineNowMarkerTop,
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
});
