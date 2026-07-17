import { describe, expect, it } from "vitest";
import { monthIndexToDate } from "./calendarScrollModel";
import { resolveScrollSettle } from "./calendarSettleModel";
import type { CalendarScrollSettleInput } from "./calendarSettleModel";

const REF_YEAR = 2026;
const REF_MONTH = 4; // May (0-indexed)
const at = (index: number) => monthIndexToDate(index, REF_YEAR, REF_MONTH);

function settle(overrides: Partial<CalendarScrollSettleInput> = {}) {
  return resolveScrollSettle({
    scrollDataIndex: 0,
    scrollMountIndex: 0,
    prevView: at(0),
    labelIndex: 0,
    refYear: REF_YEAR,
    refMonth: REF_MONTH,
    wasSuppressed: false,
    ...overrides,
  });
}

describe("resolveScrollSettle", () => {
  it("defers (and decides nothing else) while the crossing commit is still in flight", () => {
    const result = settle({ scrollDataIndex: 1, scrollMountIndex: 0 });
    expect(result).toEqual({ shouldDefer: true });
  });

  describe("user-driven settle (not suppressed)", () => {
    // Settled on index 1 (a month away from the origin prevView at index 0).
    const result = settle({
      scrollDataIndex: 1,
      scrollMountIndex: 1,
      prevView: at(0),
      labelIndex: 1,
      wasSuppressed: false,
    });

    it("does not defer", () => {
      expect(result.shouldDefer).toBe(false);
    });

    it("reports the settled month and aligns the resting row", () => {
      expect(result.settledMonth).toEqual(at(1));
      expect(result.shouldAlign).toBe(true);
    });

    it("emits a scroll-driven fetch settle without re-issuing display/label changes", () => {
      // The crossing's onScroll already issued display/label; the settle must not repeat them.
      expect(result.displayMonthChange).toBeNull();
      expect(result.labelMonthChange).toBeNull();
      expect(result.scrollDrivenAfter).toBe(false);
      expect(result.fetchSettleArgs).toEqual({ ...at(1), scrollDriven: true });
    });
  });

  describe("suppressed settle that crossed to a new month", () => {
    const result = settle({
      scrollDataIndex: 2,
      scrollMountIndex: 2,
      prevView: at(0),
      labelIndex: 2,
      wasSuppressed: true,
    });

    it("re-asserts the display month and marks the panel scroll-driven again", () => {
      expect(result.settledAway).toBe(true);
      expect(result.displayMonthChange).toEqual(at(2));
      expect(result.scrollDrivenAfter).toBe(true);
    });

    it("still emits the label change but never aligns a programmatic landing", () => {
      expect(result.labelMonthChange).toEqual(at(2));
      expect(result.shouldAlign).toBe(false);
      expect(result.fetchSettleArgs).toEqual({ ...at(2), scrollDriven: true });
    });
  });

  describe("suppressed settle that landed on the same month", () => {
    const result = settle({
      scrollDataIndex: 0,
      scrollMountIndex: 0,
      prevView: at(0),
      labelIndex: 0,
      wasSuppressed: true,
    });

    it("does not re-issue the display change and clears scroll-driven", () => {
      expect(result.settledAway).toBe(false);
      expect(result.displayMonthChange).toBeNull();
      expect(result.scrollDrivenAfter).toBe(false);
    });

    it("reports a non-scroll-driven fetch settle (an echo of the navigation)", () => {
      expect(result.fetchSettleArgs).toEqual({ ...at(0), scrollDriven: false });
      // The label still re-syncs even when the month did not change.
      expect(result.labelMonthChange).toEqual(at(0));
    });
  });

  it("marks a same-month user settle scroll-driven (isolates the !wasSuppressed operand)", () => {
    // wasSuppressed=false AND settledAway=false: scrollDriven must still be true
    // via `!wasSuppressed`, not via settledAway.
    const result = settle({
      scrollDataIndex: 0,
      scrollMountIndex: 0,
      prevView: at(0),
      labelIndex: 0,
      wasSuppressed: false,
    });
    expect(result.settledAway).toBe(false);
    expect(result.fetchSettleArgs!.scrollDriven).toBe(true);
  });

  it("treats a missing prior view as settled-away", () => {
    const result = settle({ scrollMountIndex: 0, prevView: null, wasSuppressed: true });
    expect(result.settledAway).toBe(true);
    expect(result.displayMonthChange).toEqual(at(0));
  });

  it("derives the label-month change from labelIndex, independently of the settled month", () => {
    const result = settle({
      scrollDataIndex: 2,
      scrollMountIndex: 2,
      labelIndex: 1,
      prevView: at(0),
      wasSuppressed: true,
    });
    expect(result.settledMonth).toEqual(at(2));
    expect(result.labelMonthChange).toEqual(at(1));
  });
});
