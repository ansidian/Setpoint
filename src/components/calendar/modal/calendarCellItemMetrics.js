const CELL_CAPACITY_BY_TIER = {
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
