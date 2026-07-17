import { describe, expect, it } from "vitest";
import {
  getMeasuredCellItemStackPlan,
  getMeasuredVisibleCellItemCount,
  getReservedCellItemLaneHeight,
  splitVisibleCellItems,
} from "./CalendarCellItemStackModel";

const metrics = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fullVisibleCount: 3,
  overflowVisibleCount: 2,
};

describe("CalendarCellItemStack model", () => {
  it("fits visible chips from measured height before falling back to overflow capacity", () => {
    const items = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
      { id: "fourth" },
    ];

    expect(getMeasuredVisibleCellItemCount(items, 130, metrics)).toBe(3);
    expect(getMeasuredVisibleCellItemCount(items, 100, metrics)).toBe(2);
  });

  it("reserves span lanes plus a trailing gap before deciding normal chip capacity", () => {
    const items = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ];
    const reservedHeight = getReservedCellItemLaneHeight(1, metrics);

    expect(reservedHeight).toBe(34);
    expect(getReservedCellItemLaneHeight(2, metrics)).toBe(68);
    expect(getReservedCellItemLaneHeight(0, metrics)).toBe(0);
    expect(getMeasuredVisibleCellItemCount(
      items,
      90,
      { ...metrics, reservedHeight },
    )).toBe(0);
  });

  it("only exposes overflow when the +more trigger fully fits after reserved span lanes", () => {
    const items = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ];
    const reservedHeight = getReservedCellItemLaneHeight(1, metrics);

    expect(getMeasuredCellItemStackPlan(
      items,
      reservedHeight + metrics.moreHeight,
      { ...metrics, reservedHeight },
    )).toEqual({ visibleCount: 0, overflowVisible: true });
    expect(getMeasuredCellItemStackPlan(
      items,
      reservedHeight + metrics.moreHeight - 1,
      { ...metrics, reservedHeight },
    )).toEqual({ visibleCount: 0, overflowVisible: false });
  });

  it("reserves lanes using span-lane geometry when provided", () => {
    const reservedHeight = getReservedCellItemLaneHeight(2, {
      ...metrics,
      spanLaneHeight: 36,
      spanLaneGap: 4,
    });

    expect(reservedHeight).toBe(80);
  });

  it("promotes hidden ghost chips into the visible preview slot", () => {
    const result = splitVisibleCellItems([
      { id: "real-1" },
      { id: "real-2" },
      { id: "real-3" },
      { id: "ghost-1", isGhost: true },
    ], 2);

    expect(result.visibleItems.map((item) => item.id)).toEqual([
      "real-1",
      "ghost-1",
    ]);
    expect(result.hiddenItems.map((item) => item.id)).toEqual([
      "real-2",
      "real-3",
    ]);
  });
});
