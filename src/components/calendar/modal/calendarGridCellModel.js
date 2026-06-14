import { ymdFromParts } from "../calendarDateUtils.js";
import { getCellGhosts } from "./calendarGridUtils.js";

export function buildCalendarGridCellModel({
  activeView,
  buildFallbackDayState,
  cell,
  currentMonth,
  currentYear,
  eventDateCells,
  cellGhosts: providedCellGhosts = null,
  ghostPreview,
  itemsByDate,
  itemsByDay,
  selectedCellKey,
  selectedDay,
  selectedItemId,
  shouldFilterCompletedDeadlines,
  spanLayout,
  todayDate,
  view,
  viewData,
}) {
  const day = cell.day;
  const rawItems =
    itemsByDate?.[cell.dateKey] ??
    (cell.inCurrentMonth ? itemsByDay[day] : null) ??
    [];
  const dayState =
    activeView.getDayState?.(rawItems) ??
    buildFallbackDayState(rawItems);
  const resolvedDayState = shouldFilterCompletedDeadlines
    ? {
        ...dayState,
        items: dayState.activeItems || [],
        activeItems: dayState.activeItems || [],
        completedItems: [],
        activeCount: dayState.activeCount || 0,
        completedCount: 0,
        totalCount: dayState.activeCount || 0,
      }
    : dayState;
  const cellGhosts = providedCellGhosts || getCellGhosts(ghostPreview, cell.dateKey);
  const cellItems = activeView.getDayState
    ? resolvedDayState
    : rawItems;
  const reservedLaneCount = eventDateCells
    ? spanLayout.reservedLaneCountByDate?.[cell.dateKey] || 0
    : 0;
  const pinnedGhostCount = eventDateCells
    ? spanLayout.pinnedGhostCountByDate?.[cell.dateKey] || 0
    : 0;
  const selectionPool = Array.isArray(resolvedDayState.items)
    ? resolvedDayState.items
    : rawItems;
  const hasItems =
    resolvedDayState.totalCount > 0 ||
    cellGhosts.length > 0 ||
    reservedLaneCount > 0;
  const isToday =
    cell.dateKey ===
    ymdFromParts(currentYear, currentMonth, todayDate);
  const isSelected = selectedCellKey
    ? selectedCellKey === cell.dateKey
    : selectedDay === day && cell.inCurrentMonth;
  const hasOverdue =
    activeView.hasOverdue?.(resolvedDayState) || false;
  const allComplete =
    activeView.allComplete?.(resolvedDayState) || false;
  const isPastDay =
    view === "events" &&
    new Date(`${cell.dateKey}T00:00:00`) <
      new Date(currentYear, currentMonth, todayDate);
  const pastTone = isPastDay ? (hasItems ? "items" : "empty") : null;
  const resolveItemId = activeView.getItemId || ((item) => item?.id);
  const dayHasSelectedItem =
    isSelected &&
    selectionPool.some(
      (item) =>
        activeView.matchesItemId?.(item, selectedItemId) ||
        String(resolveItemId(item)) === String(selectedItemId),
    );

  return {
    allComplete,
    cellGhosts,
    cellItems,
    dayHasSelectedItem,
    hasItems,
    hasOverdue,
    isSelected,
    isToday,
    itemCount:
      resolvedDayState.totalCount +
      cellGhosts.length +
      pinnedGhostCount,
    loading: viewData?.isLoading,
    pastTone,
    pinnedGhostCount,
    rawItems,
    reservedLaneCount,
    resolvedDayState,
    selectionPool,
  };
}
