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
  it("preserves navigable month target clamping and normalization invariants", () => {
    const cases = [
      [{ targetYear: 2026, targetMonth: 12, currentYear: 2026, currentMonth: 5 }, { year: 2027, month: 0 }],
      [{ targetYear: 2030, targetMonth: 0, currentYear: 2026, currentMonth: 5 }, { year: 2028, month: 5 }],
      [{ targetYear: 2020, targetMonth: 0, currentYear: 2026, currentMonth: 5 }, { year: 2024, month: 5 }],
    ] as const;

    for (const [input, expected] of cases) {
      expect(clampCalendarMonthTarget(input)).toEqual(expected);
    }
  });

  it("preserves month-block height across row-count, header, and tier invariants", () => {
    const cases = [
      [{ year: 2026, month: 1, cellHeight: 76, gridGap: 4, headerHeight: 0 }, 316],
      [{ year: 2026, month: 7, cellHeight: 76, gridGap: 4, headerHeight: 0 }, 396],
      [{ year: 2026, month: 5, cellHeight: 76, gridGap: 4, headerHeight: 0 }, 316],
      [{ year: 2026, month: 1, cellHeight: 76, gridGap: 4, headerHeight: 32 }, 348],
      [{ year: 2026, month: 5, cellHeight: 150, gridGap: 8, headerHeight: 0 }, 624],
    ] as const;

    for (const [input, expected] of cases) {
      expect(monthBlockHeight(input), `${input.year}-${input.month + 1} block height`).toBe(expected);
    }
  });

  it("preserves month-index conversion and round-trip invariants across years", () => {
    const reference = { year: 2026, month: 5 };
    const dateCases = [
      [0, { year: 2026, month: 5 }],
      [1, { year: 2026, month: 6 }],
      [7, { year: 2027, month: 0 }],
      [-1, { year: 2026, month: 4 }],
      [-6, { year: 2025, month: 11 }],
    ] as const;

    for (const [index, expected] of dateCases) {
      expect(monthIndexToDate(index, reference.year, reference.month), `month index ${index}`).toEqual(expected);
    }
    expect(monthIndexToDate(24, 2026, 0)).toEqual({ year: 2028, month: 0 });
    expect(monthIndexToDate(-24, 2026, 0)).toEqual({ year: 2024, month: 0 });

    const indexCases = [
      [2026, 5, 0],
      [2027, 0, 7],
      [2025, 11, -6],
    ] as const;
    for (const [year, month, expected] of indexCases) {
      expect(dateToMonthIndex(year, month, reference.year, reference.month)).toBe(expected);
    }

    for (const index of [-30, -12, -1, 0, 1, 12, 30]) {
      const date = monthIndexToDate(index, 2026, 0);
      expect(dateToMonthIndex(date.year, date.month, 2026, 0), `round trip ${index}`).toBe(index);
    }
  });

  it("preserves midpoint month selection at boundaries, offsets, and thresholds", () => {
    const offsetFromIndex = (index: number) => index * 500;
    const cases = [
      [{ scrollOffset: 0, containerHeight: 800, searchFirst: 0, searchLast: 2 }, 0],
      [{ scrollOffset: 200, containerHeight: 800, searchFirst: 0, searchLast: 2 }, 1],
      [{ scrollOffset: 100, containerHeight: 800, searchFirst: 0, searchLast: 2 }, 1],
      [{ scrollOffset: -300, containerHeight: 800, searchFirst: -2, searchLast: 0 }, 0],
      [{ scrollOffset: 0, containerHeight: 400, searchFirst: 0, searchLast: 3 }, 0],
      [{ scrollOffset: 200, containerHeight: 800, searchFirst: 0, searchLast: 2, threshold: 1 / 3 }, 0],
      [{ scrollOffset: 350, containerHeight: 800, searchFirst: 0, searchLast: 2, threshold: 1 / 3 }, 1],
    ] as const;

    for (const [input, expected] of cases) {
      expect(midpointActiveMonthIndex({ ...input, getMonthOffset: offsetFromIndex }), JSON.stringify(input)).toBe(expected);
    }
  });

  it("preserves nearest week-row snapping across row, month, and negative-offset invariants", () => {
    const args = {
      cellHeight: 140,
      gridGap: 8,
      getMonthOffset: (index: number) => index * 732,
      getMonthHeight: () => 732,
      searchFirst: -2,
      searchLast: 2,
    };
    const cases = [
      [296, 296],
      [2 * 148 + 37, 296],
      [2 * 148 + 100, 444],
      [700, 732],
      [732 + 148 + 60, 732 + 148],
      [-5, 0],
    ] as const;

    for (const [scrollOffset, expected] of cases) {
      expect(nearestWeekRowOffset({ ...args, scrollOffset }), `offset ${scrollOffset}`).toBe(expected);
    }

    const mixed = {
      ...args,
      getMonthOffset: (index: number) => (index <= 0 ? index * 732 : 584 + (index - 1) * 732),
      getMonthHeight: (index: number) => (index === 0 ? 584 : 732),
    };
    expect(nearestWeekRowOffset({ ...mixed, scrollOffset: 520 }), "mixed row counts").toBe(584);
  });

  it("preserves prefetch, mounted-window, and direction invariants", () => {
    const prefetchCases = [
      [{ visibleFirst: 0, visibleLast: 1, scrollDirection: "idle" }, { first: -3, last: 4 }],
      [{ visibleFirst: 0, visibleLast: 1, scrollDirection: "forward" }, { first: -1, last: 5 }],
      [{ visibleFirst: 0, visibleLast: 1, scrollDirection: "backward" }, { first: -4, last: 2 }],
      [{ visibleFirst: 5, visibleLast: 7, scrollDirection: "idle" }, { first: 2, last: 10 }],
    ] as const;
    for (const [input, expected] of prefetchCases) {
      expect(prefetchRange(input)).toEqual(expected);
    }

    const windowCases = [
      [0, { first: -2, last: 2 }],
      [5, { first: 3, last: 7 }],
      [-3, { first: -5, last: -1 }],
    ] as const;
    for (const [index, expected] of windowCases) {
      expect(mountedWindow(index)).toEqual(expected);
    }

    const directionCases = [
      [null, 0, "idle"],
      [3, 3, "idle"],
      [3, 4, "forward"],
      [5, 3, "backward"],
      [-2, -1, "forward"],
      [-1, -3, "backward"],
    ] as const;
    for (const [previous, current, expected] of directionCases) {
      expect(deriveScrollDirection(previous, current)).toBe(expected);
    }
  });

  it("preserves the overflow keep-open scroll-ignore window invariant", () => {
    markOverflowScrollIgnoreWindow(-Number.MAX_SAFE_INTEGER);
    expect(shouldDispatchOverflowCloseOnScroll(1_000_000)).toBe(true);

    const inside = 1_000_000;
    markOverflowScrollIgnoreWindow(inside);
    expect(shouldDispatchOverflowCloseOnScroll(inside)).toBe(false);
    expect(shouldDispatchOverflowCloseOnScroll(inside + OVERFLOW_INTERACTION_IGNORE_MS - 1)).toBe(false);

    const expired = 2_000_000;
    markOverflowScrollIgnoreWindow(expired);
    expect(shouldDispatchOverflowCloseOnScroll(expired + OVERFLOW_INTERACTION_IGNORE_MS)).toBe(true);
    expect(shouldDispatchOverflowCloseOnScroll(expired + OVERFLOW_INTERACTION_IGNORE_MS + 50)).toBe(true);
  });
});
