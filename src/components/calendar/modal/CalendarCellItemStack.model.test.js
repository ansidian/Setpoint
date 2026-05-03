import { describe, expect, it } from "vitest";
import {
  getMeasuredVisibleCellItemCount,
  getReservedCellItemLaneHeight,
  splitVisibleCellItems,
} from "./CalendarCellItemStackModel.js";

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

  it("reserves span lanes before deciding normal chip capacity", () => {
    const items = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ];
    const reservedHeight = getReservedCellItemLaneHeight(1, metrics);

    expect(reservedHeight).toBe(30);
    expect(getMeasuredVisibleCellItemCount(
      items,
      90,
      { ...metrics, reservedHeight },
    )).toBe(0);
  });

  it("keeps a hidden ghost visible by displacing the latest real chip", () => {
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
