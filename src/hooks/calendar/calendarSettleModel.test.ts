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
  it("preserves the in-flight crossing defer invariant", () => {
    const result = settle({ scrollDataIndex: 1, scrollMountIndex: 0 });
    expect(result).toEqual({ shouldDefer: true });
  });

  describe("user-driven settle invariants", () => {
    // Settled on index 1 (a month away from the origin prevView at index 0).
    const result = settle({
      scrollDataIndex: 1,
      scrollMountIndex: 1,
      prevView: at(0),
      labelIndex: 1,
      wasSuppressed: false,
    });

    it("does not defer and reports the settled month invariant", () => {
      expect(result.shouldDefer).toBe(false);
      expect(result.settledMonth).toEqual(at(1));
      expect(result.shouldAlign).toBe(true);
      // The crossing's onScroll already issued display/label; the settle must not repeat them.
      expect(result.displayMonthChange).toBeNull();
      expect(result.labelMonthChange).toBeNull();
      expect(result.scrollDrivenAfter).toBe(false);
      expect(result.fetchSettleArgs).toEqual({ ...at(1), scrollDriven: true });
    });
  });

  describe("suppressed cross-month settle invariants", () => {
    const result = settle({
      scrollDataIndex: 2,
      scrollMountIndex: 2,
      prevView: at(0),
      labelIndex: 2,
      wasSuppressed: true,
    });

    it("re-asserts display, label, and scroll-driven state without alignment", () => {
      expect(result.settledAway).toBe(true);
      expect(result.displayMonthChange).toEqual(at(2));
      expect(result.scrollDrivenAfter).toBe(true);
      expect(result.labelMonthChange).toEqual(at(2));
      expect(result.shouldAlign).toBe(false);
      expect(result.fetchSettleArgs).toEqual({ ...at(2), scrollDriven: true });
    });
  });

  describe("suppressed same-month settle invariants", () => {
    const result = settle({
      scrollDataIndex: 0,
      scrollMountIndex: 0,
      prevView: at(0),
      labelIndex: 0,
      wasSuppressed: true,
    });

    it("clears scroll-driven state without re-issuing display and preserves the echo label", () => {
      expect(result.settledAway).toBe(false);
      expect(result.displayMonthChange).toBeNull();
      expect(result.scrollDrivenAfter).toBe(false);
      expect(result.fetchSettleArgs).toEqual({ ...at(0), scrollDriven: false });
      // The label still re-syncs even when the month did not change.
      expect(result.labelMonthChange).toEqual(at(0));
    });
  });

  it("preserves the same-month user settle scroll-driven invariant", () => {
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

  it("preserves the missing-prior-view settled-away invariant", () => {
    const result = settle({ scrollMountIndex: 0, prevView: null, wasSuppressed: true });
    expect(result.settledAway).toBe(true);
    expect(result.displayMonthChange).toEqual(at(0));
  });

  it("preserves independent label-month derivation invariant", () => {
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
