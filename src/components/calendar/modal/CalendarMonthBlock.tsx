import CalendarGrid from "./CalendarGrid";
import { getMonthData } from "../calendarDateUtils.ts";
import { resolveMountedMonthData } from "./calendarMonthPreviewModel";
import { resolveMonthBlockState } from "./calendarMonthBlockModel";
import type { CalendarGridProps } from "./CalendarGrid";
import type { CalendarMonthPreviewEntry, MountedMonthData } from "./calendarMonthPreviewModel";
import type { CalendarSpanEvent } from "./calendarEventSpanLayout";

const emptyObj: Record<string, never> = {};

export interface CalendarMonthBlockProps extends Omit<
  CalendarGridProps,
  "viewYear" | "viewMonth" | "firstDay" | "daysInMonth" | "showWeekHeader" | "isActiveMonth" | "previewEvents" | "previewDeadlineOverlay" | "viewData" | "itemsByDay" | "itemsByDate" | "cellMetaByDate"
> {
  index: number;
  year: number;
  month: number;
  height: number;
  viewYear: number;
  viewMonth: number;
  cached: (MountedMonthData & { key: string; view: string }) | null;
  activeMonthData: MountedMonthData;
  shareItemsByDate?: boolean;
  previewByIndex: Map<number, CalendarMonthPreviewEntry<CalendarSpanEvent & { id: string | number }>>;
  isMonthCached?: ((year: number, month: number) => boolean) | null;
}

// One mounted month inside the scroll container: derives its active/cached/
// skeleton state, resolves its data (active map, cached map, shared bills map,
// or a lightweight preview), and renders the headerless CalendarGrid. Extracted
// from CalendarScrollContainer's render loop so the container is a thin map over
// the mounted window.
export default function CalendarMonthBlock({
  index,
  year,
  month,
  height,
  view,
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  todayDate,
  layout,
  activeView,
  cached,
  activeMonthData,
  shareItemsByDate,
  previewByIndex,
  isMonthCached,
  showGridSkeleton = false,
  selectedDay,
  selectedDateKey,
  selectedItemId,
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
}: CalendarMonthBlockProps) {
  const { firstDay, daysInMonth } = getMonthData(year, month);
  const monthCached = isMonthCached ? isMonthCached(year, month) : false;
  const { isActive, isCached, hasFullData, blockSkeleton } = resolveMonthBlockState({
    year,
    month,
    viewYear,
    viewMonth,
    cached,
    monthCached,
    showGridSkeleton,
    shareItemsByDate,
  });
  const preview = hasFullData ? null : previewByIndex.get(index);
  const previewEvents = preview?.events ?? null;
  const monthDeadlineOverlay = preview ? preview.deadlineOverlay : null;
  const monthData = resolveMountedMonthData({
    isActive,
    isCached,
    cached,
    active: activeMonthData,
    shareItemsByDate,
    empty: emptyObj,
  }) as Pick<CalendarGridProps, "viewData" | "itemsByDay" | "itemsByDate" | "cellMetaByDate">;

  return (
    <div
      data-month-block
      data-month-index={index}
      data-testid={`month-block-${year}-${month}`}
      style={{
        height,
        position: "relative",
        zIndex: undefined,
      }}
    >
      <CalendarGrid
        view={view}
        viewYear={year}
        viewMonth={month}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        firstDay={firstDay}
        daysInMonth={daysInMonth}
        layout={layout}
        activeView={activeView}
        showWeekHeader={false}
        isActiveMonth={isActive}
        previewEvents={previewEvents}
        previewDeadlineOverlay={monthDeadlineOverlay}
        viewData={monthData.viewData}
        itemsByDay={monthData.itemsByDay}
        itemsByDate={monthData.itemsByDate}
        cellMetaByDate={monthData.cellMetaByDate}
        selectedDay={selectedDay}
        selectedDateKey={selectedDateKey}
        selectedItemId={selectedItemId}
        showGridSkeleton={blockSkeleton}
        buildFallbackDayState={buildFallbackDayState}
        closeEventEditor={closeEventEditor}
        setSelectedDay={setSelectedDay}
        setSelectedDateKey={setSelectedDateKey}
        setSelectedItemId={setSelectedItemId}
        eventQuickActions={eventQuickActions}
        deadlineQuickActions={deadlineQuickActions}
        ghostPreview={isActive ? ghostPreview : null}
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
      />
    </div>
  );
}
