import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import CalendarMonthBlock from "./CalendarMonthBlock";
import { buildMonthPreviewEntries } from "./calendarMonthPreviewModel";
import { monthIndexToDate, NAVIGABLE_MONTH_RADIUS } from "../../../hooks/calendar/calendarScrollModel";
import useEditorCancelOnScroll from "../../../hooks/calendar/useEditorCancelOnScroll";
import useCalendarScrollViewport from "../../../hooks/calendar/useCalendarScrollViewport";
import type { CalendarMonthPosition } from "../../../hooks/calendar/calendarScrollModel";
import type { CalendarGridProps } from "./CalendarGrid";
import type { CalendarCellWeather } from "./CalendarCell";
import type { CalendarGridItemLike } from "./calendarGridCellModel";
import type { CalendarMonthPreviewEntry, MountedMonthData } from "./calendarMonthPreviewModel";
import type { CalendarSpanEvent } from "./calendarEventSpanLayout";

const SCROLL_RANGE = NAVIGABLE_MONTH_RADIUS;

type PreviewCalendarEvent = CalendarSpanEvent & { id: string | number };

export interface CalendarScrollContainerProps extends Omit<
  CalendarGridProps,
  "firstDay" | "daysInMonth" | "showWeekHeader" | "isActiveMonth" | "previewEvents" | "previewDeadlineOverlay" | "itemsByDay" | "itemsByDate" | "cellMetaByDate" | "showGridSkeleton"
> {
  itemsByDay?: Record<number, CalendarGridItemLike[]>;
  itemsByDate?: Record<string, CalendarGridItemLike[]>;
  cellMetaByDate?: Record<string, { weather?: CalendarCellWeather | null }>;
  onDisplayMonthChange?: (target: CalendarMonthPosition) => void;
  onLabelMonthChange?: (target: CalendarMonthPosition) => void;
  onFetchSettle?: (target: CalendarMonthPosition & { scrollDriven: boolean }) => void;
  isMonthCached?: ((year: number, month: number) => boolean) | null;
  getMonthEvents?: ((year: number, month: number) => PreviewCalendarEvent[] | null) | null;
  getMonthDeadlines?: ((year: number, month: number) => unknown) | null;
  dataRevision?: number;
  showGridSkeleton?: boolean;
}

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
  showGridSkeleton = false,
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
}: CalendarScrollContainerProps) {
  const maybeCancelEditorOnScroll = useEditorCancelOnScroll({
    floatingDetailOpen: !!floatingDetailOpen,
    floatingDetailMode,
    floatingEditorDirty: !!floatingEditorDirty,
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
  const previewCacheRef = useRef<Map<number, CalendarMonthPreviewEntry<PreviewCalendarEvent>> | null>(null);
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
  const [monthDataState, setMonthDataState] = useState<{
    tracked: MountedMonthData & { key: string; view: string };
    cached: (MountedMonthData & { key: string; view: string }) | null;
  }>(() => ({
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

  const blocks: ReactNode[] = [];
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

const emptyObj: Record<string, never> = {};
