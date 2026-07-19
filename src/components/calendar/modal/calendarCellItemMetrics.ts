export type CalendarLayoutTier = "uhd" | "xl" | "lg" | "md" | "sm";

export interface CalendarCellCapacity {
  fullVisibleCount: number;
  overflowVisibleCount: number;
}

export interface CalendarCellCapacityInput extends Partial<CalendarCellCapacity> {
  fallback?: number;
}

export function createCalendarCellMetricsResolver<TLayout extends object, TMetrics>(
  compute: (layout?: TLayout | null) => TMetrics,
): (layout?: TLayout | null) => TMetrics {
  const cache = new WeakMap<TLayout, TMetrics>();

  return (layout) => {
    if (!layout || typeof layout !== "object") return compute(layout);
    if (cache.has(layout)) return cache.get(layout) as TMetrics;
    const metrics = compute(layout);
    cache.set(layout, metrics);
    return metrics;
  };
}

const CELL_CAPACITY_BY_TIER: Record<CalendarLayoutTier, CalendarCellCapacity> = {
  uhd: {
    fullVisibleCount: 11,
    overflowVisibleCount: 10,
  },
  xl: {
    fullVisibleCount: 6,
    overflowVisibleCount: 5,
  },
  lg: {
    fullVisibleCount: 4,
    overflowVisibleCount: 3,
  },
  md: {
    fullVisibleCount: 3,
    overflowVisibleCount: 2,
  },
  sm: {
    fullVisibleCount: 2,
    overflowVisibleCount: 1,
  },
};

export function getCalendarCellCapacity(layout: { tier?: CalendarLayoutTier } | null | undefined): CalendarCellCapacity {
  return CELL_CAPACITY_BY_TIER[layout?.tier ?? "md"];
}

export function getVisibleCellItemCount(itemCount: number, metrics: CalendarCellCapacityInput = {}): number {
  if (itemCount <= 0) return 0;

  const fullVisibleCount = Math.max(0, metrics.fullVisibleCount ?? metrics.fallback ?? 2);
  const overflowVisibleCount = Math.max(
    0,
    metrics.overflowVisibleCount ?? Math.max(0, fullVisibleCount - 1),
  );

  if (itemCount <= fullVisibleCount) return itemCount;
  return Math.min(itemCount, overflowVisibleCount);
}
