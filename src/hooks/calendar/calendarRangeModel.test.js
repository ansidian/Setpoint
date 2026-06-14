import { describe, expect, it } from "vitest";

import {
  expandMonthKeys,
  groupMonthKeys,
  monthBounds,
  monthKey,
  monthsInRange,
  planPrefetchMonthGroups,
  planVisibleMonthFetches,
} from "./calendarRangeModel.js";

describe("calendar range model", () => {
  it("returns inclusive month keys for a date range", () => {
    expect(monthsInRange("2026-04-28", "2026-06-02")).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("expands visible months by radius", () => {
    expect(expandMonthKeys(["2026-05"], 1)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("groups contiguous month keys by max fetch width", () => {
    expect(groupMonthKeys(["2026-04", "2026-05", "2026-06", "2026-08"], 2)).toEqual([
      ["2026-04", "2026-05"],
      ["2026-06"],
      ["2026-08"],
    ]);
  });

  it("computes month keys and month bounds", () => {
    expect(monthKey(2026, 0)).toBe("2026-01");
    expect(monthBounds("2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("plans visible month fetches around cache and in-flight months", () => {
    expect(planVisibleMonthFetches("2026-04-26", "2026-06-06", {
      cachedKeys: ["2026-04"],
      inFlightKeys: ["2026-05"],
    })).toEqual({
      visibleKeys: ["2026-04", "2026-05", "2026-06"],
      missingKeys: ["2026-06"],
      pendingKeys: ["2026-05"],
      missingGroups: [["2026-06"]],
    });
  });

  it("plans adjacent month prefetch groups outside the visible range", () => {
    expect(planPrefetchMonthGroups(["2026-04", "2026-05", "2026-06"], {
      cachedKeys: ["2026-03"],
      inFlightKeys: [],
      prefetchMonthRadius: 1,
    })).toEqual([["2026-07"]]);
  });
});
