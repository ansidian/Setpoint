import { useMemo, useRef, useState } from "react";
import CalendarMonthBlock from "./CalendarMonthBlock.jsx";
import { buildMonthPreviewEntries } from "./calendarMonthPreviewModel.js";
import { monthIndexToDate, NAVIGABLE_MONTH_RADIUS } from "../../../hooks/calendar/calendarScrollModel.js";
import useEditorCancelOnScroll from "../../../hooks/calendar/useEditorCancelOnScroll.js";
import useCalendarScrollViewport from "../../../hooks/calendar/useCalendarScrollViewport.js";

const SCROLL_RANGE = NAVIGABLE_MONTH_RADIUS;

export default function CalendarScrollContainer({
  view,
  activeView,
  layout,
  currentYear,
  currentMonth,
  todayDate,
  viewYear,
  viewMonth,
  onDisplayMonthChange,
  onLabelMonthChange,
  onFetchSettle,
  viewData,
  itemsByDay = emptyObj,
  itemsByDate = emptyObj,
  cellMetaByDate = emptyObj,
  selectedDay,
  selectedDateKey,
  selectedItemId,
  showGridSkeleton,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  eventQuickActions,
  deadlineQuickActions,
  ghostPreview,
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  floatingDetailOpen,
  floatingDetailItemId,
  floatingDetailMode,
  floatingDetailDateKey,
  floatingEditorDirty,
  onCancelFloatingEditor,
  onShakeFloatingEditor,
  onDirectDateAction,
  onDirectItemAction,
  isMonthCached,
  getMonthEvents,
  getMonthDeadlines,
  dataRevision = 0,
}) {
  const maybeCancelEditorOnScroll = useEditorCancelOnScroll({
    floatingDetailOpen,
    floatingDetailMode,
    floatingEditorDirty,
    onCancelFloatingEditor,
  });

  const { containerRef, refYear, refMonth, wFirst, wLast, getHeight } = useCalendarScrollViewport({
    viewYear,
    viewMonth,
    currentYear,
    currentMonth,
    layout,
    onDisplayMonthChange,
    onLabelMonthChange,
    onFetchSettle,
    maybeCancelEditorOnScroll,
  });

  const previewDeadlineOverlay = viewData?.deadlineOverlay ?? null;

  // Preview data for mounted non-active months, keyed by month index.
  // CalendarGrid is memoized, so entry *field* identity is load-bearing:
  // buildMonthPreviewEntries reuses a month's entry whenever its underlying
  // inputs are unchanged, keeping window shifts and unrelated data revisions
  // from re-rendering every mounted grid mid-scroll.
  const previewCacheRef = useRef(null);
  const previewByIndex = useMemo(() => {
    const map = buildMonthPreviewEntries({
      previous: previewCacheRef.current,
      first: wFirst,
      last: wLast,
      refYear,
      refMonth,
      getMonthEvents,
      getMonthDeadlines,
      activeDeadlineOverlay: previewDeadlineOverlay,
    });
    previewCacheRef.current = map;
    return map;
    // dataRevision invalidates the ref-backed getMonthEvents/getMonthDeadlines caches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wFirst, wLast, refYear, refMonth, getMonthEvents, getMonthDeadlines, previewDeadlineOverlay, dataRevision]);

  const activeKey = `${viewYear}-${viewMonth}`;
  const currentMonthData = useMemo(
    () => ({ key: activeKey, view, viewData, itemsByDay, itemsByDate, cellMetaByDate }),
    [activeKey, view, viewData, itemsByDay, itemsByDate, cellMetaByDate],
  );
  const [monthDataState, setMonthDataState] = useState(() => ({
    tracked: currentMonthData,
    cached: null,
  }));
  if (monthDataState.tracked.key !== activeKey || monthDataState.tracked.view !== view) {
    setMonthDataState({
      tracked: currentMonthData,
      cached: monthDataState.tracked.view === view ? monthDataState.tracked : null,
    });
  } else if (monthDataState.tracked !== currentMonthData) {
    setMonthDataState(prev => ({ ...prev, tracked: currentMonthData }));
  }

  const cachedMonthData = monthDataState.cached?.view === view
    ? monthDataState.cached
    : null;

  // Faint week-row texture for unmounted spacers. Only ±2 months are mounted, so
  // a fast fling can briefly outrun the window and park the viewport on a spacer
  // until the next rAF+commit mounts the month. Drawing the grid's week-row pitch
  // makes that moment read as an empty calendar loading in, not a blank void.
  // Pure CSS on the existing divs: no extra DOM, and off-screen spacers never
  // paint it, so the normal-scroll cost is unchanged.
  const spacerRowPitch = layout.cellHeight + layout.gridGap;
  const spacerBackground = `repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent ${spacerRowPitch}px)`;

  const activeMonthData = { viewData, itemsByDay, itemsByDate, cellMetaByDate };
  const shareItemsByDate = !!activeView?.monthAgnosticItemsByDate;

  const blocks = [];
  for (let i = -SCROLL_RANGE; i <= SCROLL_RANGE; i++) {
    const { year, month } = monthIndexToDate(i, refYear, refMonth);
    const height = getHeight(i);
    const isMounted = i >= wFirst && i <= wLast;

    if (!isMounted) {
      blocks.push(
        <div
          key={i}
          data-month-index={i}
          data-testid={`month-spacer-${year}-${month}`}
          style={{ height, background: spacerBackground }}
        />,
      );
      continue;
    }

    blocks.push(
      <CalendarMonthBlock
        key={i}
        index={i}
        year={year}
        month={month}
        height={height}
        view={view}
        viewYear={viewYear}
        viewMonth={viewMonth}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        layout={layout}
        activeView={activeView}
        cached={cachedMonthData}
        activeMonthData={activeMonthData}
        shareItemsByDate={shareItemsByDate}
        previewByIndex={previewByIndex}
        isMonthCached={isMonthCached}
        showGridSkeleton={showGridSkeleton}
        selectedDay={selectedDay}
        selectedDateKey={selectedDateKey}
        selectedItemId={selectedItemId}
        buildFallbackDayState={buildFallbackDayState}
        closeEventEditor={closeEventEditor}
        setSelectedDay={setSelectedDay}
        setSelectedDateKey={setSelectedDateKey}
        setSelectedItemId={setSelectedItemId}
        eventQuickActions={eventQuickActions}
        deadlineQuickActions={deadlineQuickActions}
        ghostPreview={ghostPreview}
        onOpenFloatingDetail={onOpenFloatingDetail}
        onCloseFloatingDetail={onCloseFloatingDetail}
        floatingDetailOpen={floatingDetailOpen}
        floatingDetailItemId={floatingDetailItemId}
        floatingDetailMode={floatingDetailMode}
        floatingDetailDateKey={floatingDetailDateKey}
        floatingEditorDirty={floatingEditorDirty}
        onCancelFloatingEditor={onCancelFloatingEditor}
        onShakeFloatingEditor={onShakeFloatingEditor}
        onDirectDateAction={onDirectDateAction}
        onDirectItemAction={onDirectItemAction}
      />,
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="calendar-scroll-container"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        position: "relative",
      }}
    >
      {blocks}
    </div>
  );
}

const emptyObj = {};
