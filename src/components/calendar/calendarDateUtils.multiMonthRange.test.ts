import { describe, expect, it } from "vitest";
import { getMultiMonthGridRange, getVisibleGridRange } from "./calendarDateUtils.ts";

describe("getMultiMonthGridRange", () => {
  it("equals the single-month grid range at radius 0", () => {
    const single = getVisibleGridRange(2026, 4);
    const multi = getMultiMonthGridRange(2026, 4, 0);
    expect(multi.start).toBe(single.start);
    expect(multi.end).toBe(single.end);
  });

  it("spans from the earliest grid start to the latest grid end across the radius", () => {
    // May 2026, radius 2 → grids of Mar..Jul must all be covered.
    const range = getMultiMonthGridRange(2026, 4, 2);
    expect(range.start).toBe(getVisibleGridRange(2026, 2).start); // March grid start
    expect(range.end).toBe(getVisibleGridRange(2026, 6).end); // July grid end
  });

  it("crosses year boundaries when the radius underflows/overflows the month", () => {
    // January 2026, radius 3 → reaches back to October 2025 and forward to April 2026.
    const range = getMultiMonthGridRange(2026, 0, 3);
    expect(range.start).toBe(getVisibleGridRange(2025, 9).start); // Oct 2025 grid start
    expect(range.end).toBe(getVisibleGridRange(2026, 3).end); // Apr 2026 grid end
  });
});
