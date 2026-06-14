import { getVisibleCellItemCount } from "./calendarCellItemMetrics.js";

export function splitVisibleCellItems(items, visibleCount) {
  let count = Math.min(Math.max(0, visibleCount), items.length);
  if (count === 0 && items.some((item) => item.isGhost)) {
    count = 1;
  }
  if (count >= items.length) return { visibleItems: items, hiddenItems: [] };

  const visibleItems = items.slice(0, count);
  const hiddenGhost = items.slice(count).find((item) => item.isGhost);
  if (hiddenGhost) {
    visibleItems[count - 1] = hiddenGhost;
  }
  const visibleIds = new Set(visibleItems.map((item) => String(item.id)));

  return {
    visibleItems,
    hiddenItems: items.filter((item) => !visibleIds.has(String(item.id))),
  };
}

export function getCellItemStackHeight({ visibleCount, hasOverflow, metrics }) {
  const itemHeight = metrics?.itemHeight ?? 24;
  const moreHeight = metrics?.moreHeight ?? 22;
  const gap = metrics?.gap ?? 4;
  const childCount = visibleCount + (hasOverflow ? 1 : 0);

  if (childCount <= 0) return 0;
  return (visibleCount * itemHeight)
    + (hasOverflow ? moreHeight : 0)
    + ((childCount - 1) * gap);
}

// Includes a trailing gap after the last lane so the first stacked chip keeps
// the same rhythm against pinned span lanes as chips keep between themselves.
export function getReservedCellItemLaneHeight(count, metrics) {
  if (count <= 0) return 0;
  const itemHeight = metrics?.spanLaneHeight ?? metrics?.itemHeight ?? 28;
  const gap = metrics?.spanLaneGap ?? metrics?.gap ?? 4;
  return count * (itemHeight + gap);
}

export function getMeasuredVisibleCellItemCount(items, availableHeight, metrics) {
  const itemCount = items.length;
  if (itemCount <= 0) return 0;
  const reservedHeight = Math.max(0, metrics?.reservedHeight || 0);
  const effectiveAvailableHeight = Number.isFinite(availableHeight)
    ? Math.max(0, availableHeight - reservedHeight)
    : availableHeight;
  if (!Number.isFinite(effectiveAvailableHeight) || effectiveAvailableHeight <= 0) {
    return getVisibleCellItemCount(itemCount, metrics);
  }

  if (getCellItemStackHeight({ visibleCount: itemCount, hasOverflow: false, metrics }) <= effectiveAvailableHeight) {
    return itemCount;
  }

  const minimumVisible = items.some((item) => item.isGhost) ? 1 : 0;
  for (let count = itemCount - 1; count >= minimumVisible; count -= 1) {
    if (getCellItemStackHeight({ visibleCount: count, hasOverflow: true, metrics }) <= effectiveAvailableHeight) {
      return count;
    }
  }

  return minimumVisible;
}
