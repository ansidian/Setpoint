import { describe, expect, it, vi } from "vitest";
import {
  createCalendarCellMetricsResolver,
  getCalendarCellCapacity,
  getVisibleCellItemCount,
} from "./calendarCellItemMetrics.ts";

describe("calendar cell item metrics", () => {
  it("caches computed metrics by the intentional layout-object identity boundary", () => {
    const compute = vi.fn((layout?: { tier?: string } | null) => ({ tier: layout?.tier || "md" }));
    const resolve = createCalendarCellMetricsResolver(compute);
    const layout = { tier: "lg" };

    const first = resolve(layout);
    expect(resolve(layout)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);

    const equivalentLayout = { tier: "lg" };
    expect(resolve(equivalentLayout)).toEqual(first);
    expect(resolve(equivalentLayout)).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("computes uncached fallback metrics when no layout object exists", () => {
    const compute = vi.fn(() => ({ tier: "md" }));
    const resolve = createCalendarCellMetricsResolver(compute);

    expect(resolve(undefined)).toEqual({ tier: "md" });
    expect(resolve(null)).toEqual({ tier: "md" });
    expect(compute).toHaveBeenCalledTimes(2);
  });

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
