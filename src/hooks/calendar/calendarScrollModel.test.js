import { describe, expect, it } from "vitest";

import {
  monthBlockHeight,
  monthIndexToDate,
  dateToMonthIndex,
  visibleMonthIndices,
  activeMonthIndex,
  midpointActiveMonthIndex,
  prefetchRange,
  mountedWindow,
  deriveScrollDirection,
} from "./calendarScrollModel.js";

describe("calendarScrollModel", () => {
  describe("monthBlockHeight", () => {
    it("uses renderedRows (4) for Feb 2026 — no trailing boundary", () => {
      // Feb 2026: starts Sunday, 28 days, renderedRows = 4 (no boundary to give away)
      expect(monthBlockHeight({ year: 2026, month: 1, cellHeight: 76, gridGap: 4, headerHeight: 0 }))
        .toBe(4 * 76 + 3 * 4); // 316
    });

    it("uses renderedRows (5) for Aug 2026 — trailing boundary excluded", () => {
      // Aug 2026: 6 total rows, but trailing boundary given to Sep → renderedRows = 5
      expect(monthBlockHeight({ year: 2026, month: 7, cellHeight: 76, gridGap: 4, headerHeight: 0 }))
        .toBe(5 * 76 + 4 * 4); // 396
    });

    it("uses renderedRows (4) for Jun 2026 — trailing boundary excluded", () => {
      // Jun 2026: 5 total rows, but trailing boundary given to Jul → renderedRows = 4
      expect(monthBlockHeight({ year: 2026, month: 5, cellHeight: 76, gridGap: 4, headerHeight: 0 }))
        .toBe(4 * 76 + 3 * 4); // 316
    });

    it("includes headerHeight in total", () => {
      expect(monthBlockHeight({ year: 2026, month: 1, cellHeight: 76, gridGap: 4, headerHeight: 32 }))
        .toBe(4 * 76 + 3 * 4 + 32); // 348
    });

    it("works with different breakpoint tier values", () => {
      // Jun 2026 UHD tier: renderedRows = 4, cellHeight=150, gridGap=8
      expect(monthBlockHeight({ year: 2026, month: 5, cellHeight: 150, gridGap: 8, headerHeight: 0 }))
        .toBe(4 * 150 + 3 * 8); // 624
    });
  });

  describe("monthIndexToDate / dateToMonthIndex", () => {
    it("index 0 maps to the reference month", () => {
      expect(monthIndexToDate(0, 2026, 5)).toEqual({ year: 2026, month: 5 });
    });

    it("positive indices map to future months", () => {
      expect(monthIndexToDate(1, 2026, 5)).toEqual({ year: 2026, month: 6 });
      expect(monthIndexToDate(7, 2026, 5)).toEqual({ year: 2027, month: 0 });
    });

    it("negative indices map to past months", () => {
      expect(monthIndexToDate(-1, 2026, 5)).toEqual({ year: 2026, month: 4 });
      expect(monthIndexToDate(-6, 2026, 5)).toEqual({ year: 2025, month: 11 });
    });

    it("spans multiple years in both directions", () => {
      expect(monthIndexToDate(24, 2026, 0)).toEqual({ year: 2028, month: 0 });
      expect(monthIndexToDate(-24, 2026, 0)).toEqual({ year: 2024, month: 0 });
    });

    it("dateToMonthIndex inverts monthIndexToDate", () => {
      expect(dateToMonthIndex(2026, 5, 2026, 5)).toBe(0);
      expect(dateToMonthIndex(2027, 0, 2026, 5)).toBe(7);
      expect(dateToMonthIndex(2025, 11, 2026, 5)).toBe(-6);
    });

    it("round-trips correctly across year boundaries", () => {
      const ref = { year: 2026, month: 5 };
      for (const idx of [-30, -12, -1, 0, 1, 12, 30]) {
        const date = monthIndexToDate(idx, ref.year, ref.month);
        expect(dateToMonthIndex(date.year, date.month, ref.year, ref.month)).toBe(idx);
      }
    });
  });

  describe("visibleMonthIndices", () => {
    const fixedHeight = () => 500;

    it("returns single month when viewport fits within one block", () => {
      expect(visibleMonthIndices({ scrollOffset: 100, containerHeight: 300, getMonthHeight: fixedHeight }))
        .toEqual({ first: 0, last: 0 });
    });

    it("returns two months when viewport spans a boundary", () => {
      // Viewport [250, 650) spans month 0 [0,500) and month 1 [500,1000)
      expect(visibleMonthIndices({ scrollOffset: 250, containerHeight: 400, getMonthHeight: fixedHeight }))
        .toEqual({ first: 0, last: 1 });
    });

    it("advances at exact month boundary", () => {
      // Viewport [500, 900) — month 0 ends exactly at 500, month 1 starts at 500
      expect(visibleMonthIndices({ scrollOffset: 500, containerHeight: 400, getMonthHeight: fixedHeight }))
        .toEqual({ first: 1, last: 1 });
    });

    it("handles negative scroll offsets", () => {
      // Viewport [-250, 150) spans month -1 [-500,0) and month 0 [0,500)
      expect(visibleMonthIndices({ scrollOffset: -250, containerHeight: 400, getMonthHeight: fixedHeight }))
        .toEqual({ first: -1, last: 0 });
    });

    it("handles large viewport covering multiple months", () => {
      // Viewport [0, 1600) covers months 0,1,2 fully and part of 3
      expect(visibleMonthIndices({ scrollOffset: 0, containerHeight: 1600, getMonthHeight: fixedHeight }))
        .toEqual({ first: 0, last: 3 });
    });
  });

  describe("activeMonthIndex", () => {
    const offsetFromIndex = (i) => i * 500;

    it("returns the month at the viewport top", () => {
      expect(activeMonthIndex({
        visibleIndices: { first: 0, last: 1 },
        scrollOffset: 0,
        getMonthOffset: offsetFromIndex,
      })).toBe(0);
    });

    it("returns the topmost month whose start is at or above viewport top", () => {
      // scrollOffset=750: month 1 starts at 500 (≤ 750), month 2 starts at 1000 (> 750)
      expect(activeMonthIndex({
        visibleIndices: { first: 1, last: 2 },
        scrollOffset: 750,
        getMonthOffset: offsetFromIndex,
      })).toBe(1);
    });

    it("advances when scrolled exactly to a month boundary", () => {
      expect(activeMonthIndex({
        visibleIndices: { first: 2, last: 3 },
        scrollOffset: 1000,
        getMonthOffset: offsetFromIndex,
      })).toBe(2);
    });

    it("works with negative indices", () => {
      expect(activeMonthIndex({
        visibleIndices: { first: -2, last: -1 },
        scrollOffset: -750,
        getMonthOffset: offsetFromIndex,
      })).toBe(-2);
    });
  });

  describe("midpointActiveMonthIndex", () => {
    const offsetFromIndex = (i) => i * 500;

    it("returns the month whose block contains the viewport midpoint (default threshold)", () => {
      // viewport [0, 800), midpoint = 400, month 0 [0, 500) contains 400
      expect(midpointActiveMonthIndex({
        scrollOffset: 0,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 2,
      })).toBe(0);
    });

    it("flips to next month when midpoint crosses boundary", () => {
      // viewport [200, 1000), midpoint = 600, month 1 [500, 1000) contains 600
      expect(midpointActiveMonthIndex({
        scrollOffset: 200,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 2,
      })).toBe(1);
    });

    it("returns next month when midpoint lands exactly on boundary", () => {
      // viewport [100, 900), midpoint = 500 exactly = month 1 start
      expect(midpointActiveMonthIndex({
        scrollOffset: 100,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 2,
      })).toBe(1);
    });

    it("works with negative indices", () => {
      // month -2 at -1000, month -1 at -500, month 0 at 0
      // viewport [-300, 500), midpoint = 100, month 0 at 0 ≤ 100
      expect(midpointActiveMonthIndex({
        scrollOffset: -300,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: -2,
        searchLast: 0,
      })).toBe(0);
    });

    it("stays on first month when midpoint is near top of content", () => {
      // viewport [0, 400), midpoint = 200, month 0 [0, 500) contains 200
      expect(midpointActiveMonthIndex({
        scrollOffset: 0,
        containerHeight: 400,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 3,
      })).toBe(0);
    });

    it("uses custom threshold for lazy label switching", () => {
      // viewport [200, 1000), threshold=1/3 → point = 200 + 800*(1/3) ≈ 467
      // month 1 at 500 > 467 → stays on month 0
      expect(midpointActiveMonthIndex({
        scrollOffset: 200,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 2,
        threshold: 1 / 3,
      })).toBe(0);

      // viewport [350, 1150), threshold=1/3 → point = 350 + 800*(1/3) ≈ 617
      // month 1 at 500 ≤ 617 → flips to month 1
      expect(midpointActiveMonthIndex({
        scrollOffset: 350,
        containerHeight: 800,
        getMonthOffset: offsetFromIndex,
        searchFirst: 0,
        searchLast: 2,
        threshold: 1 / 3,
      })).toBe(1);
    });
  });

  describe("prefetchRange", () => {
    it("is symmetric ±3 when idle", () => {
      expect(prefetchRange({ visibleFirst: 0, visibleLast: 1, scrollDirection: "idle" }))
        .toEqual({ first: -3, last: 4 });
    });

    it("biases +4/−1 when scrolling forward", () => {
      expect(prefetchRange({ visibleFirst: 0, visibleLast: 1, scrollDirection: "forward" }))
        .toEqual({ first: -1, last: 5 });
    });

    it("biases −4/+1 when scrolling backward", () => {
      expect(prefetchRange({ visibleFirst: 0, visibleLast: 1, scrollDirection: "backward" }))
        .toEqual({ first: -4, last: 2 });
    });

    it("works with non-zero visible range", () => {
      expect(prefetchRange({ visibleFirst: 5, visibleLast: 7, scrollDirection: "idle" }))
        .toEqual({ first: 2, last: 10 });
    });
  });

  describe("mountedWindow", () => {
    it("returns 5 indices centered on the active index", () => {
      expect(mountedWindow(0)).toEqual({ first: -2, last: 2 });
    });

    it("shifts with positive active index", () => {
      expect(mountedWindow(5)).toEqual({ first: 3, last: 7 });
    });

    it("shifts with negative active index", () => {
      expect(mountedWindow(-3)).toEqual({ first: -5, last: -1 });
    });
  });

  describe("deriveScrollDirection", () => {
    it("returns idle when previous index is null", () => {
      expect(deriveScrollDirection(null, 0)).toBe("idle");
    });

    it("returns idle when indices are equal", () => {
      expect(deriveScrollDirection(3, 3)).toBe("idle");
    });

    it("returns forward when current index is greater", () => {
      expect(deriveScrollDirection(3, 4)).toBe("forward");
    });

    it("returns backward when current index is smaller", () => {
      expect(deriveScrollDirection(5, 3)).toBe("backward");
    });

    it("works with negative indices", () => {
      expect(deriveScrollDirection(-2, -1)).toBe("forward");
      expect(deriveScrollDirection(-1, -3)).toBe("backward");
    });
  });
});
