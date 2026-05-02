import { describe, expect, it } from "vitest";
import { resolveNowMarkerTarget } from "./useNowMarkerLayout.js";

function card(offsetTop, offsetHeight) {
  return { offsetTop, offsetHeight };
}

describe("resolveNowMarkerTarget", () => {
  it("places the marker proportionally inside an in-progress event", () => {
    const target = resolveNowMarkerTarget({
      events: [
        { allDay: false, startMs: 100, endMs: 300 },
      ],
      nowMs: 200,
      cards: [card(40, 80)],
    });

    expect(target).toEqual({
      markerTop: 80,
      inProgressIdx: 0,
      measureCard: card(40, 80),
    });
  });

  it("places the marker before the first future event", () => {
    expect(resolveNowMarkerTarget({
      events: [{ allDay: false, startMs: 200, endMs: 300 }],
      nowMs: 100,
      cards: [card(40, 80)],
    })).toEqual({
      markerTop: 0,
      inProgressIdx: -1,
      measureCard: null,
    });
  });

  it("places the marker after the previous event when a later event is future", () => {
    expect(resolveNowMarkerTarget({
      events: [
        { allDay: false, startMs: 100, endMs: 150 },
        { allDay: false, startMs: 300, endMs: 350 },
      ],
      nowMs: 200,
      cards: [card(20, 30), card(70, 30)],
    })).toEqual({
      markerTop: 50,
      inProgressIdx: -1,
      measureCard: null,
    });
  });

  it("places the marker after the last event when the day is over", () => {
    expect(resolveNowMarkerTarget({
      events: [{ allDay: false, startMs: 100, endMs: 150 }],
      nowMs: 200,
      cards: [card(20, 30)],
    })).toEqual({
      markerTop: 50,
      inProgressIdx: -1,
      measureCard: null,
    });
  });
});
