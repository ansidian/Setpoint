import { describe, expect, it } from "vitest";
import {
  layoutConflictTimelineItems,
  resolveConflictTimelineHeight,
} from "./calendarConflictTimelineLayout";

describe("resolveConflictTimelineHeight", () => {
  it("grows to preserve a minimum-height card and bottom safety inset", () => {
    expect(resolveConflictTimelineHeight(360, [
      { top: 316.8, height: 66 },
    ], 12)).toBe(394.8);
  });

  it("keeps the base height when every card already fits", () => {
    expect(resolveConflictTimelineHeight(360, [
      { top: 40, height: 120 },
      { top: 200, height: 54 },
    ], 8)).toBe(360);
  });
});

describe("layoutConflictTimelineItems", () => {
  it("gives every visually concurrent existing event and proposal its own lane", () => {
    const layout = layoutConflictTimelineItems([
      { id: "long-existing", top: 0, height: 120 },
      { id: "short-existing", top: 50, height: 42 },
      { id: "proposal", top: 50, height: 42, draft: true },
    ]);

    expect(layout.map(({ id, lane, laneCount }) => ({ id, lane, laneCount }))).toEqual([
      { id: "long-existing", lane: 0, laneCount: 3 },
      { id: "short-existing", lane: 1, laneCount: 3 },
      { id: "proposal", lane: 2, laneCount: 3 },
    ]);
  });

  it("supports triple-booked existing events without covering the proposal", () => {
    const layout = layoutConflictTimelineItems([
      { id: "existing-1", top: 20, height: 80 },
      { id: "existing-2", top: 30, height: 60 },
      { id: "existing-3", top: 40, height: 50 },
      { id: "proposal", top: 45, height: 42, draft: true },
    ]);

    expect(layout.map((item) => item.lane)).toEqual([0, 1, 2, 3]);
    expect(layout.every((item) => item.laneCount === 4)).toBe(true);
  });

  it("keeps an earlier-starting proposal in the rightmost overlap lane", () => {
    const layout = layoutConflictTimelineItems([
      { id: "existing", top: 60, height: 225 },
      { id: "proposal", top: 0, height: 75, draft: true },
    ]);

    expect(layout.map(({ id, lane, laneCount }) => ({ id, lane, laneCount }))).toEqual([
      { id: "existing", lane: 0, laneCount: 2 },
      { id: "proposal", lane: 1, laneCount: 2 },
    ]);
  });

  it("reuses lanes outside each visual overlap group", () => {
    const layout = layoutConflictTimelineItems([
      { id: "before", top: 0, height: 42 },
      { id: "after", top: 42, height: 42 },
      { id: "nearby", top: 90, height: 42 },
    ]);

    expect(layout.map(({ lane, laneCount }) => ({ lane, laneCount }))).toEqual([
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
    ]);
  });

  it("separates zero-duration cards when their rendered minimum heights collide", () => {
    const layout = layoutConflictTimelineItems([
      { id: "zero-duration", top: 50, height: 42 },
      { id: "proposal", top: 50, height: 42, draft: true },
    ]);

    expect(layout.map((item) => item.lane)).toEqual([0, 1]);
    expect(layout.every((item) => item.laneCount === 2)).toBe(true);
  });
});
