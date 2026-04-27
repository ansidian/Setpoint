const CELL_CAPACITY_BY_TIER = {
  uhd: {
    fullVisibleCount: 8,
    overflowVisibleCount: 7,
  },
  xl: {
    fullVisibleCount: 4,
    overflowVisibleCount: 3,
  },
  lg: {
    fullVisibleCount: 3,
    overflowVisibleCount: 2,
  },
  md: {
    fullVisibleCount: 2,
    overflowVisibleCount: 1,
  },
  sm: {
    fullVisibleCount: 1,
    overflowVisibleCount: 0,
  },
};

export function getCalendarCellCapacity(layout) {
  return CELL_CAPACITY_BY_TIER[layout?.tier] || CELL_CAPACITY_BY_TIER.md;
}

export function getVisibleCellItemCount(itemCount, metrics = {}) {
  if (itemCount <= 0) return 0;

  const fullVisibleCount = Math.max(0, metrics.fullVisibleCount ?? metrics.fallback ?? 2);
  const overflowVisibleCount = Math.max(
    0,
    metrics.overflowVisibleCount ?? Math.max(0, fullVisibleCount - 1),
  );

  if (itemCount <= fullVisibleCount) return itemCount;
  return Math.min(itemCount, overflowVisibleCount);
}
