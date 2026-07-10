import { memo, useMemo } from "react";
import CalendarCell from "./CalendarCell.jsx";
import { buildCalendarGridCellModel } from "./calendarGridCellModel.js";
import { isPinnedCalendarGhost } from "./calendarEventSpanLayout.js";
import { sameOverflowDate } from "./calendarGridUtils.js";
import { buildGridRows, leadingBoundaryType } from "../../../hooks/calendar/calendarGridRowModel.js";

const BOUNDARY_BORDER_COLOR = "color-mix(in srgb, var(--sp-blue) 32%, transparent)";
const BOUNDARY_BORDER_COLOR_CURRENT = "#0095FF";

export default function CalendarGridCells({
  activeView,
  buildFallbackDayState,
  cellMetaByDate,
  currentMonth,
  currentYear,
  eventDateCells,
  ghostPreview,
  isActiveMonth = true,
  itemQuickActions,
  itemsByDate,
  itemsByDay,
  layout,
  monthCells,
  onBeforeItemAction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onInlineOverflowInteraction,
  onOpenOverflow,
  onSelectDay,
  onSelectItem,
  resolvedOverflow,
  selectedCellKey,
  selectedDay,
  selectedItemId,
  shouldFilterCompletedDeadlines,
  spanLayout,
  suppressedSelectedHiddenAutoOpenKey,
  todayDate,
  view,
  viewData,
  viewMonth,
  viewYear,
}) {
  const gridRows = useMemo(() => buildGridRows(viewYear, viewMonth), [viewYear, viewMonth]);
  const cellGhostsByDate = useStableCellGhostsByDate(ghostPreview?.ghosts);
  const cellLookup = useMemo(() => {
    const m = {};
    for (const cell of monthCells) {
      if (cell.dateKey) m[cell.dateKey] = cell;
    }
    return m;
  }, [monthCells]);

  const viewIsCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;

  const firstDayOffset = new Date(viewYear, viewMonth, 1).getDay();
  const boundaryType = leadingBoundaryType(viewYear, viewMonth);
  const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
  const prevMonthYear = viewMonth === 0 ? viewYear - 1 : viewYear;
  const boundaryTouchesCurrentMonth =
    viewIsCurrentMonth || (prevMonthYear === currentYear && prevMonth === currentMonth);
  const boundaryColor = boundaryTouchesCurrentMonth
    ? BOUNDARY_BORDER_COLOR_CURRENT
    : BOUNDARY_BORDER_COLOR;

  return gridRows.map((rowCells, weekIndex) => (
    <div
      key={weekIndex}
      role="row"
      data-testid="calendar-week-row"
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: layout.gridGap,
        minHeight: 0,
      }}
    >
      {weekIndex === 0 && boundaryType === "step" && (
        <BoundaryStepOverlay
          prevCount={firstDayOffset}
          gridGap={layout.gridGap}
          color={boundaryColor}
        />
      )}
      {weekIndex === 0 && boundaryType === "straight" && (
        <BoundaryStraightOverlay color={boundaryColor} />
      )}
      {rowCells.map((gridCell) => {
        const cell = cellLookup[gridCell.dateKey] || {
          day: gridCell.dayOfMonth,
          dateKey: gridCell.dateKey,
          dateLabel: String(gridCell.dayOfMonth),
          inCurrentMonth: gridCell.inCurrentMonth,
          boundarySides: [],
        };
        const day = cell.day;
        const cellMeta = cellMetaByDate?.[cell.dateKey] || null;
        const anchorKey = `${view}-${cell.dateKey || `${viewYear}-${viewMonth}-${day}`}`;
        const overflowOpen = sameOverflowDate(
          resolvedOverflow,
          cell.dateKey,
          day,
        );
        const overflowMode = overflowOpen ? resolvedOverflow?.mode : null;
        const inlineOverflowOpen = overflowOpen && overflowMode === "inline";

        return (
          <CalendarGridCellSlot
            key={cell.dateKey || day}
            activeView={activeView}
            anchorKey={anchorKey}
            buildFallbackDayState={buildFallbackDayState}
            cell={cell}
            cellGhosts={cellGhostsByDate[cell.dateKey] || emptyGhosts}
            cellMeta={cellMeta}
            currentMonth={currentMonth}
            currentYear={currentYear}
            day={day}
            eventDateCells={eventDateCells}
            isActiveMonth={isActiveMonth}
            itemQuickActions={itemQuickActions}
            itemsByDate={itemsByDate}
            itemsByDay={itemsByDay}
            layout={layout}
            overflowOpen={overflowOpen}
            overflowMode={overflowMode}
            inlineOverflowOpen={inlineOverflowOpen}
            inlineOverflowAutoFocus={inlineOverflowOpen
              ? resolvedOverflow?.focusOnOpen !== false
              : true}
            inlineOverflowVisibleCount={inlineOverflowOpen
              ? resolvedOverflow?.visibleCount
              : null}
            selectedCellKey={selectedCellKey}
            selectedDay={selectedDay}
            selectedItemId={selectedItemId}
            shouldFilterCompletedDeadlines={shouldFilterCompletedDeadlines}
            spanLayout={spanLayout}
            todayDate={todayDate}
            view={view}
            viewYear={viewYear}
            viewMonth={viewMonth}
            viewData={viewData}
            onBeforeItemAction={onBeforeItemAction}
            onCloseInlineOverflow={onCloseInlineOverflow}
            onHiddenItemsChange={onHiddenItemsChange}
            onInlineOverflowInteraction={onInlineOverflowInteraction}
            onOpenOverflow={onOpenOverflow}
            onSelectDay={onSelectDay}
            onSelectItem={onSelectItem}
            suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
          />
        );
      })}
    </div>
  ));
}

const emptyGhosts = [];
const emptyGhostsByDate = {};

const CalendarGridCellSlot = memo(function CalendarGridCellSlot({
  activeView,
  anchorKey,
  buildFallbackDayState,
  cell,
  cellGhosts,
  cellMeta,
  currentMonth,
  currentYear,
  day,
  eventDateCells,
  isActiveMonth,
  itemQuickActions,
  itemsByDate,
  itemsByDay,
  layout,
  overflowOpen,
  overflowMode,
  inlineOverflowOpen,
  inlineOverflowAutoFocus,
  inlineOverflowVisibleCount,
  selectedCellKey,
  selectedDay,
  selectedItemId,
  shouldFilterCompletedDeadlines,
  spanLayout,
  todayDate,
  view,
  viewData,
  viewMonth,
  viewYear,
  onBeforeItemAction,
  onCloseInlineOverflow,
  onHiddenItemsChange,
  onInlineOverflowInteraction,
  onOpenOverflow,
  onSelectDay,
  onSelectItem,
  suppressedSelectedHiddenAutoOpenKey,
}) {
  const {
    allComplete,
    cellItems,
    dayHasSelectedItem,
    hasItems,
    hasOverdue,
    isSelected,
    isToday,
    itemCount,
    loading,
    pastTone,
    reservedLaneCount,
  } = buildCalendarGridCellModel({
    activeView,
    buildFallbackDayState,
    cell,
    cellGhosts,
    currentMonth,
    currentYear,
    eventDateCells,
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
  });
  return (
    <CalendarCell
      isActiveMonth={isActiveMonth}
      view={view}
      viewYear={viewYear}
      viewMonth={viewMonth}
      viewLabel={activeView.label || view}
      day={day}
      dateKey={cell.dateKey}
      dateLabel={cell.dateLabel}
      inCurrentMonth={cell.inCurrentMonth}
      items={cellItems}
      ghosts={cellGhosts}
      cellMeta={cellMeta}
      selectedItemId={dayHasSelectedItem ? selectedItemId : null}
      itemCount={itemCount}
      hasItems={hasItems}
      isToday={isToday}
      isSelected={isSelected}
      pastTone={pastTone}
      hasOverdue={hasOverdue}
      allComplete={allComplete}
      loading={loading}
      overflowOpen={overflowOpen}
      overflowMode={overflowMode}
      onSelectDay={() =>
        onSelectDay?.(day, isSelected, cell.dateKey)
      }
      onSelectDateHeader={() =>
        onSelectDay?.(day, isSelected, cell.dateKey, {
          clearItemSelection: true,
          directDateAction: false,
        })
      }
      onSelectItem={(itemId, anchorMeta) =>
        onSelectItem?.(day, itemId, cell.dateKey, {
          keepOverflowOpen: overflowOpen,
          anchorMeta,
        })
      }
      onOpenOverflow={(composition) =>
        onOpenOverflow?.({
          ...composition,
          anchorKey,
          cell,
          day,
        })
      }
      renderCellContents={(args) =>
        activeView.renderCellContents?.({
          ...args,
          overflowOpen,
          overflowAnchorKey: anchorKey,
          inlineOverflowOpen,
          inlineOverflowAutoFocus,
          inlineOverflowVisibleCount,
          inlineOverflowExternal: true,
          onInlineOverflowInteraction,
          onCloseInlineOverflow,
          onHiddenItemsChange,
          onBeforeItemAction,
          suppressedSelectedHiddenAutoOpenKey,
          pinnedIds: eventDateCells ? spanLayout.pinnedIds : null,
          pinnedIdsByDate: eventDateCells ? spanLayout.pinnedIdsByDate : null,
          pinnedOverflowByDate: eventDateCells ? spanLayout.pinnedOverflowByDate : null,
          reservedLaneCount,
          layout,
        })
      }
      quickActions={itemQuickActions}
    />
  );
}, sameCalendarGridCellSlotProps);

function sameCalendarGridCellSlotProps(previous, next) {
  return previous.activeView === next.activeView
    && previous.anchorKey === next.anchorKey
    && previous.buildFallbackDayState === next.buildFallbackDayState
    && previous.cell === next.cell
    && previous.cellGhosts === next.cellGhosts
    && previous.cellMeta === next.cellMeta
    && previous.currentMonth === next.currentMonth
    && previous.currentYear === next.currentYear
    && previous.day === next.day
    && previous.eventDateCells === next.eventDateCells
    && previous.isActiveMonth === next.isActiveMonth
    && previous.itemQuickActions === next.itemQuickActions
    && previous.itemsByDate === next.itemsByDate
    && previous.itemsByDay === next.itemsByDay
    && previous.layout === next.layout
    && previous.overflowOpen === next.overflowOpen
    && previous.overflowMode === next.overflowMode
    && previous.inlineOverflowOpen === next.inlineOverflowOpen
    && previous.inlineOverflowAutoFocus === next.inlineOverflowAutoFocus
    && previous.inlineOverflowVisibleCount === next.inlineOverflowVisibleCount
    && previous.selectedCellKey === next.selectedCellKey
    && previous.selectedDay === next.selectedDay
    && previous.selectedItemId === next.selectedItemId
    && previous.shouldFilterCompletedDeadlines === next.shouldFilterCompletedDeadlines
    && previous.spanLayout === next.spanLayout
    && previous.suppressedSelectedHiddenAutoOpenKey === next.suppressedSelectedHiddenAutoOpenKey
    && previous.todayDate === next.todayDate
    && previous.view === next.view
    && previous.viewData === next.viewData
    && previous.viewMonth === next.viewMonth
    && previous.viewYear === next.viewYear;
}

function useStableCellGhostsByDate(ghosts) {
  const signature = cellGhostSignature(ghosts);

  return useMemo(() => {
    if (!signature) return emptyGhostsByDate;
    const nextGhostsByDate = {};
    for (const ghost of JSON.parse(signature)) {
      const dateKey = ghost.startDate;
      if (!nextGhostsByDate[dateKey]) nextGhostsByDate[dateKey] = [];
      nextGhostsByDate[dateKey].push(ghost);
    }
    return nextGhostsByDate;
  }, [signature]);
}

function selectCellGhosts(ghosts) {
  return (ghosts || []).filter((ghost) => {
    if (!ghost?.startDate) return false;
    if (ghost.kind === "deadline") return true;
    return ghost.kind === "event"
      && ghost.startDate === ghost.endDate
      && !isPinnedCalendarGhost(ghost);
  });
}

function cellGhostSignature(ghosts) {
  const cellGhosts = selectCellGhosts(ghosts);
  if (!cellGhosts.length) return "";
  return JSON.stringify(cellGhosts.map((ghost) => ({
    id: ghost?.id || "",
    kind: ghost?.kind || "",
    title: ghost?.title || "",
    startDate: ghost?.startDate || "",
    endDate: ghost?.endDate || "",
    startTime: ghost?.startTime || "",
    endTime: ghost?.endTime || "",
    dueTime: ghost?.dueTime || "",
    allDay: !!ghost?.allDay,
    color: ghost?.color || "",
    sourceColor: ghost?.sourceColor || "",
    conflictCount: ghost?.conflictCount || 0,
    hasConflict: !!ghost?.hasConflict,
  })));
}

function BoundaryStepOverlay({ prevCount, gridGap, color }) {
  const g = gridGap;
  const stepX = `calc(${prevCount} * (100% - ${6 * g}px) / 7 + ${(prevCount - 1) * g}px + ${g / 2}px)`;
  const r = 8;
  const w = 2;
  return (
    <div
      aria-hidden
      data-testid="calendar-boundary-step"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <span style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: `calc(${stepX} - ${r}px)`,
        height: w,
        background: color,
        borderRadius: `${r}px 0 0 ${r}px`,
      }} />
      <span style={{
        position: "absolute",
        left: `calc(${stepX} - ${w / 2}px)`,
        top: r,
        bottom: r,
        width: w,
        background: color,
      }} />
      <span style={{
        position: "absolute",
        left: `calc(${stepX} + ${r}px)`,
        right: 0,
        top: 0,
        height: w,
        background: color,
        borderRadius: `0 ${r}px ${r}px 0`,
      }} />
      <span style={{
        position: "absolute",
        left: `calc(${stepX} - ${w / 2}px)`,
        top: 0,
        width: r + w,
        height: r + w,
        borderTop: `${w}px solid ${color}`,
        borderLeft: `${w}px solid ${color}`,
        borderTopLeftRadius: r + w,
        boxSizing: "border-box",
        background: "transparent",
      }} />
      <span style={{
        position: "absolute",
        left: `calc(${stepX} - ${w / 2}px - ${r}px)`,
        bottom: 0,
        width: r + w,
        height: r + w,
        borderBottom: `${w}px solid ${color}`,
        borderRight: `${w}px solid ${color}`,
        borderBottomRightRadius: r + w,
        boxSizing: "border-box",
        background: "transparent",
      }} />
    </div>
  );
}

function BoundaryStraightOverlay({ color }) {
  return (
    <div
      aria-hidden
      data-testid="calendar-boundary-straight"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: color,
        borderRadius: 1,
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  );
}
