function buildHeight(visibleCount, hasMore, metrics) {
  if (visibleCount <= 0) return 0;
  const childCount = visibleCount + (hasMore ? 1 : 0);
  return (
    visibleCount * metrics.itemHeight +
    (hasMore ? metrics.moreHeight : 0) +
    Math.max(0, childCount - 1) * metrics.gap
  );
}

export function getVisibleCellItemCount(itemCount, contentHeight, metrics = {}) {
  if (itemCount <= 0) return 0;

  const resolvedMetrics = {
    itemHeight: metrics.itemHeight ?? 20,
    moreHeight: metrics.moreHeight ?? 16,
    gap: metrics.gap ?? 4,
    fallback: metrics.fallback ?? 2,
  };
  const fallback = Math.min(itemCount, resolvedMetrics.fallback);

  if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
    return fallback;
  }

  for (let visibleCount = itemCount; visibleCount >= 1; visibleCount -= 1) {
    const hiddenCount = itemCount - visibleCount;
    if (buildHeight(visibleCount, hiddenCount > 0, resolvedMetrics) <= contentHeight) {
      return visibleCount;
    }
  }

  return 1;
}
