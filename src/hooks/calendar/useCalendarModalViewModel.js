import { useMemo } from "react";
import { getMonthData } from "../../components/calendar/calendarDateUtils.js";
import useCalendarGhostPreview from "../../components/calendar/useCalendarGhostPreview.js";
import {
  formatFloatingDetailLabel,
  formatFloatingEditorLabel,
} from "./calendarFloatingDetailModel.js";

function buildFallbackDayState(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return {
    items,
    activeItems: items,
    completedItems: [],
    activeCount: items.length,
    completedCount: 0,
    totalCount: items.length,
  };
}

export { buildFallbackDayState };

export default function useCalendarModalViewModel({
  open,
  view,
  viewData,
  activeView,
  activeLayout,
  currentYear,
  currentMonth,
  viewYear,
  viewMonth,
  activeSelectedDay,
  activeSelectedDateKey,
  activeSelectedItemId,
  eventEditor,
  deadlineEditor,
  deadlineDraftPreview,
  weatherData,
  floatingDetail,
  setMonthMotionDirection,
  setViewDate,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  manualMonthBrowseKey,
}) {
  const computed = useMemo(
    () => activeView.compute({ data: viewData, viewYear, viewMonth, weatherData }),
    [activeView, viewData, viewYear, viewMonth, weatherData],
  );
  const itemsByDay = useMemo(() => computed.itemsByDay || {}, [computed.itemsByDay]);
  const ghostPreview = useCalendarGhostPreview({
    open,
    view,
    viewData,
    computed,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    viewYear,
    viewMonth,
    setMonthMotionDirection,
    setViewDate,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    manualMonthBrowseKey,
  });

  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const trailingEmpty = 42 - (firstDay + daysInMonth);
  const canGoPrev = activeView.canNavigateBack
    ? activeView.canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data: viewData, computed })
    : !isCurrentMonth;

  const selectedDayRawItems = activeSelectedDay != null
    ? (computed.itemsByDate?.[activeSelectedDateKey] ?? itemsByDay[activeSelectedDay])
    : [];
  const selectedDayState = activeSelectedDay != null
    ? (activeView.getDayState?.(selectedDayRawItems) ?? buildFallbackDayState(selectedDayRawItems))
    : buildFallbackDayState([]);
  const selectedItems = activeView.getDayState ? selectedDayState : selectedDayState.items;
  const effectiveSelectedItemId = (() => {
    if (activeSelectedDay == null || selectedDayState.totalCount === 0) return null;
    if (activeSelectedItemId == null) return null;
    if (!activeView.getItemId) return activeSelectedItemId;

    const pool = view === "deadlines"
      ? [...selectedDayState.activeItems, ...selectedDayState.completedItems]
      : Array.isArray(selectedItems)
        ? selectedItems
        : selectedDayState.items || [];
    const resolveItemId = activeView.getItemId;
    const hasSelectedItem = pool.some((item) => (
      activeView.matchesItemId?.(item, activeSelectedItemId)
      || String(resolveItemId(item)) === String(activeSelectedItemId)
    ));
    return hasSelectedItem ? String(activeSelectedItemId) : null;
  })();
  const hasSelectedDay = activeSelectedDay != null;
  const showDeadlineEditor = view === "deadlines" && !!deadlineEditor;
  const showEventsLoading = view === "events" && viewData?.isLoading && (computed?.totalEvents || 0) === 0;
  const hasRenderableDeadlineData = view === "deadlines"
    && Object.values(itemsByDay).some((state) => {
      const dayState = activeView.getDayState?.(state) ?? buildFallbackDayState(state);
      return (dayState.totalCount || 0) > 0;
    });
  const showDeadlinesPendingUpdate = view === "deadlines" && !!viewData?.isLoading && hasRenderableDeadlineData;
  const showDeadlinesLoadingState = view === "deadlines" && !!viewData?.isLoading && !hasRenderableDeadlineData;
  const showGridSkeleton = showEventsLoading || showDeadlinesLoadingState;
  const showDetail = view === "deadlines"
    ? showDeadlineEditor || (!showDeadlinesLoadingState && hasSelectedDay && selectedDayState.totalCount > 0)
    : hasSelectedDay && selectedDayState.totalCount > 0;
  const showEmptySelection = view === "deadlines"
    ? hasSelectedDay && selectedDayState.totalCount === 0 && !showDeadlineEditor && !showDeadlinesLoadingState
    : hasSelectedDay && selectedDayState.totalCount === 0;
  const floatingDetailLabel = floatingDetail?.open
    ? (floatingDetail.mode === "edit" || floatingDetail.mode === "create"
        ? formatFloatingEditorLabel(
            floatingDetail.mode,
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
          )
        : formatFloatingDetailLabel(
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
          ))
    : "";
  const layout = activeLayout;
  const panelWidth = layout.panelWidth || `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" });

  return {
    buildFallbackDayState,
    canGoPrev,
    computed,
    daysInMonth,
    effectiveSelectedItemId,
    firstDay,
    floatingDetailLabel,
    ghostPreview,
    itemsByDay,
    layout,
    monthName,
    monthYear: String(viewYear),
    panelWidth,
    pendingUpdate: showDeadlinesPendingUpdate,
    selectedDayState,
    selectedItems,
    showDetail,
    showEmptySelection,
    showGridSkeleton,
    trailingEmpty,
  };
}
