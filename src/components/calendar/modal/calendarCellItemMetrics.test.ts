import { describe, expect, it } from "vitest";
import {
  getCalendarCellCapacity,
  getVisibleCellItemCount,
} from "./calendarCellItemMetrics.ts";

describe("calendar cell item metrics", () => {
  it.each([
    ["uhd", 11, 10],
    ["xl", 6, 5],
    ["lg", 4, 3],
    ["md", 3, 2],
    ["sm", 2, 1],
  ] as const)("owns %s tier capacity", (tier, fullVisibleCount, overflowVisibleCount) => {
    expect(getCalendarCellCapacity({ tier })).toEqual({ fullVisibleCount, overflowVisibleCount });
  });

  it("uses full capacity until overflow needs to reserve the +more control", () => {
    const metrics = { fullVisibleCount: 3, overflowVisibleCount: 2 };

    expect(getVisibleCellItemCount(0, metrics)).toBe(0);
    expect(getVisibleCellItemCount(3, metrics)).toBe(3);
    expect(getVisibleCellItemCount(4, metrics)).toBe(2);
  });
});
