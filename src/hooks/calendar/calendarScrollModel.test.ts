import { describe, expect, it } from "vitest";

import {
  monthBlockHeight,
  monthIndexToDate,
  dateToMonthIndex,
  midpointActiveMonthIndex,
  nearestWeekRowOffset,
  prefetchRange,
  mountedWindow,
  deriveScrollDirection,
  clampCalendarMonthTarget,
  OVERFLOW_INTERACTION_IGNORE_MS,
  markOverflowScrollIgnoreWindow,
  shouldDispatchOverflowCloseOnScroll,
} from "./calendarScrollModel";

describe("calendarScrollModel", () => {
  describe("clampCalendarMonthTarget", () => {
    it("normalizes month overflow and clamps targets to the navigable radius", () => {
      expect(clampCalendarMonthTarget({
        targetYear: 2026,
        targetMonth: 12,
        currentYear: 2026,
        currentMonth: 5,
      })).toEqual({ year: 2027, month: 0 });

      expect(clampCalendarMonthTarget({
        targetYear: 2030,
        targetMonth: 0,
        currentYear: 2026,
        currentMonth: 5,
      })).toEqual({ year: 2028, month: 5 });

      expect(clampCalendarMonthTarget({
        targetYear: 2020,
        targetMonth: 0,
        currentYear: 2026,
        currentMonth: 5,
      })).toEqual({ year: 2024, month: 5 });
    });
  });

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

  describe("midpointActiveMonthIndex", () => {
    const offsetFromIndex = (i: number) => i * 500;

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

  describe("nearestWeekRowOffset", () => {
    // Two 5-row months (height 5*140 + 4*8 = 732) starting at 0 and 732;
    // week-row pitch = cellHeight + gridGap = 148.
    const args = {
      cellHeight: 140,
      gridGap: 8,
      getMonthOffset: (i: number) => i * 732,
      getMonthHeight: () => 732,
      searchFirst: -2,
      searchLast: 2,
    };

    it("returns the offset unchanged when already on a row start", () => {
      expect(nearestWeekRowOffset({ ...args, scrollOffset: 296 })).toBe(296);
    });

    it("rounds down to the previous row start within half a pitch", () => {
      expect(nearestWeekRowOffset({ ...args, scrollOffset: 2 * 148 + 37 })).toBe(296);
    });

    it("rounds up to the next row start past half a pitch", () => {
      expect(nearestWeekRowOffset({ ...args, scrollOffset: 2 * 148 + 100 })).toBe(444);
    });

    it("snaps to the next month start when that is nearer than the last row", () => {
      // Last row start = 732 - 140 = 592; offset 700 is 108 from it but only
      // 32 from the next month start.
      expect(nearestWeekRowOffset({ ...args, scrollOffset: 700 })).toBe(732);
    });

    it("resolves rows inside a later month block", () => {
      expect(nearestWeekRowOffset({ ...args, scrollOffset: 732 + 148 + 60 })).toBe(732 + 148);
    });

    it("snaps slightly negative offsets to the row start at zero", () => {
      expect(nearestWeekRowOffset({ ...args, scrollOffset: -5 })).toBe(0);
    });

    it("handles months with different row counts via getMonthHeight", () => {
      // Month 0 has 4 rows (height 4*140 + 3*8 = 584), month 1 starts at 584.
      const mixed = {
        ...args,
        getMonthOffset: (i: number) => (i <= 0 ? i * 732 : 584 + (i - 1) * 732),
        getMonthHeight: (i: number) => (i === 0 ? 584 : 732),
      };
      // Offset 520: last row of month 0 starts at 584 - 140 = 444 (76 away);
      // month 1 starts at 584 (64 away) → next month start wins.
      expect(nearestWeekRowOffset({ ...mixed, scrollOffset: 520 })).toBe(584);
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

  // P3-11: a keep-overflow-open chip interaction triggers a programmatic
  // alignment scroll; the scroll-driven overflow-close dispatch must skip that
  // scroll (within the ignore window) so the overflow the user acted in is not
  // dismissed. Escape closes via a different dispatch site and never routes
  // through this predicate.
  describe("overflow keep-open ignore window", () => {
    it("dispatches close on a scroll with no prior interaction", () => {
      // Establish the "no prior interaction" precondition explicitly: a sibling
      // test may have opened the (module-level) ignore window, so push it far
      // into the past instead of relying on a fresh module. A fresh scroll
      // after that closes.
      markOverflowScrollIgnoreWindow(-Number.MAX_SAFE_INTEGER);
      expect(shouldDispatchOverflowCloseOnScroll(1_000_000)).toBe(true);
    });

    it("suppresses close for a scroll within the ignore window", () => {
      const t = 1_000_000;
      markOverflowScrollIgnoreWindow(t);
      // Same tick and anywhere inside the 220ms window: no close.
      expect(shouldDispatchOverflowCloseOnScroll(t)).toBe(false);
      expect(shouldDispatchOverflowCloseOnScroll(t + OVERFLOW_INTERACTION_IGNORE_MS - 1)).toBe(false);
    });

    it("dispatches close once the ignore window has elapsed", () => {
      const t = 2_000_000;
      markOverflowScrollIgnoreWindow(t);
      // At the window boundary the guard has expired (>= comparison).
      expect(shouldDispatchOverflowCloseOnScroll(t + OVERFLOW_INTERACTION_IGNORE_MS)).toBe(true);
      expect(shouldDispatchOverflowCloseOnScroll(t + OVERFLOW_INTERACTION_IGNORE_MS + 50)).toBe(true);
    });
  });
});
