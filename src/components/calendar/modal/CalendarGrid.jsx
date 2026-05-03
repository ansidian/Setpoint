import { useCallback, useMemo, useRef, useState } from "react";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import CalendarMonthBoundaryOverlay from "./CalendarMonthBoundaryOverlay.jsx";
import { parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { buildCalendarEventSpanLayout } from "./calendarEventSpanLayout.js";
import { getEventSelectionId } from "../../../lib/redesign-helpers";
import CalendarCell from "./CalendarCell.jsx";
import CalendarGridSkeleton from "./CalendarGridSkeleton.jsx";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader.jsx";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer.jsx";
import useCalendarGridEffects from "./useCalendarGridEffects.js";
import {
  GRID_ROWS,
  buildCalendarMonthCells,
  canUseInlineOverflow,
  createMonthWheelState,
  getCellGhosts,
  resolveInlineOverflowAnchor,
  sameOverflowDate,
  spanCoversOverflowDate,
} from "./calendarGridUtils.js";

function overflowHiddenSignature(items) {
  return (items || []).map((item) => String(item.id)).join("\u001f");
}

export default function CalendarGrid({
  view,
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  todayDate,
  firstDay,
  daysInMonth,
  trailingEmpty,
  itemsByDay,
  itemsByDate,
  cellMetaByDate,
  selectedDay,
  selectedDateKey,
  selectedItemId,
  viewData,
  activeView,
  layout,
  suppressOutsideClick,
  showGridSkeleton,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  setDeadlineEditor,
  eventQuickActions,
  deadlineQuickActions,
  ghostPreview,
  canGoPrev = true,
  navigateMonth,
  monthWheelStateRef,
  monthMotionDirection = 0,
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  onReanchorFloatingDetail,
  floatingDetailOpen = false,
  floatingDetailParked = false,
  floatingDetailMode = null,
  floatingDetailDateKey = null,
  floatingEditorDirty = false,
  onShakeFloatingEditor,
  onDirectDateAction,
  onDirectItemAction,
  showCompletedDeadlines = true,
}) {
  const gridShellRef = useRef(null);
  const gridBodyRef = useRef(null);
  const fallbackMonthWheelStateRef = useRef(createMonthWheelState());
  const activeMonthWheelStateRef = monthWheelStateRef || fallbackMonthWheelStateRef;
  const ignoreOverflowScrollUntilRef = useRef(0);
  const [activeSpanSegmentId, setActiveSpanSegmentId] = useState(null);
  const fillGridHeight = !layout.stacked;
  const gridRowCount = fillGridHeight
    ? Math.max(1, Math.ceil((firstDay + daysInMonth) / 7))
    : GRID_ROWS;
  const resolvedTrailingEmpty = fillGridHeight
    ? Math.max(0, gridRowCount * 7 - firstDay - daysInMonth)
    : trailingEmpty;
  const [overflowState, setOverflowState] = useState(null);
  const resolvedOverflow =
    overflowState &&
    overflowState.view === view &&
    overflowState.viewYear === viewYear &&
    overflowState.viewMonth === viewMonth
      ? overflowState
      : null;
  const resolvedPopover =
    resolvedOverflow?.mode === "fallback" ? resolvedOverflow : null;
  const eventDateCells = view === "events";
  const shouldFilterCompletedDeadlines = view === "deadlines" && !showCompletedDeadlines;
  const itemQuickActions = eventDateCells
    ? eventQuickActions
    : view === "deadlines"
      ? deadlineQuickActions
      : null;
  const selectedCellKey = selectedDateKey;
  const floatingEditorOpen = floatingDetailMode === "edit" || floatingDetailMode === "create";
  const eventCellCount = (fillGridHeight ? gridRowCount : GRID_ROWS) * 7;
  const monthCells = buildCalendarMonthCells({
    cellCount: eventCellCount,
    currentMonth,
    currentYear,
    firstDay,
    viewMonth,
    viewYear,
  });

  const spanLayout = useMemo(() => {
    if (view !== "events") {
      return {
        spanSegments: [],
        pinnedByDate: {},
        reservedLaneCountByDate: {},
        pinnedGhostCountByDate: {},
        pinnedIds: new Set(),
      };
    }
    return buildCalendarEventSpanLayout({
      monthCells,
      events: viewData?.events || [],
      ghosts: ghostPreview?.ghosts || [],
      layout,
    });
  }, [ghostPreview?.ghosts, layout, monthCells, view, viewData?.events]);

  const closeOverflow = useCallback(
    ({ restoreFocus = false } = {}) => {
      const anchorKey = overflowState?.anchorKey;
      setOverflowState(null);
      if (!restoreFocus || !anchorKey) return;
      window.requestAnimationFrame(() => {
        const trigger = [
          ...(gridShellRef.current?.querySelectorAll(
            "[data-calendar-overflow-anchor-key]",
          ) || []),
        ].find(
          (element) =>
            element.getAttribute("data-calendar-overflow-anchor-key") ===
            anchorKey,
        );
        trigger?.focus?.();
      });
    },
    [overflowState?.anchorKey, setOverflowState],
  );
  const closeOverflowWithoutFocus = useCallback(() => {
    setOverflowState(null);
  }, [setOverflowState]);
  const validateOverflowHiddenItems = useCallback((composition) => {
    setOverflowState((current) => {
      if (!sameOverflowDate(current, composition.dateKey, composition.day)) {
        return current;
      }
      const nextSignature = composition.hiddenSignature ?? overflowHiddenSignature(composition.hiddenItems);
      if (
        current.hiddenSignature === nextSignature
        && current.totalCount === composition.totalCount
        && current.visibleCount === composition.visibleCount
      ) {
        return current;
      }
      return null;
    });
  }, [setOverflowState]);
  const markOverflowInteraction = useCallback(() => {
    ignoreOverflowScrollUntilRef.current = performance.now() + 220;
  }, []);

  function handleSelectDay(
    day,
    isSelected,
    dateKey = null,
    { clearItemSelection = false, directDateAction = true } = {},
  ) {
    if (
      floatingEditorOpen
      && floatingDetailDateKey
      && dateKey === floatingDetailDateKey
      && selectedItemId == null
    ) {
      return;
    }
    if (floatingEditorDirty) {
      onShakeFloatingEditor?.();
      return;
    }
    const isOverflowSourceDay = sameOverflowDate(
      resolvedOverflow,
      dateKey,
      day,
    );
    if (!isOverflowSourceDay) setOverflowState(null);
    if (isSelected && (!clearItemSelection || selectedItemId == null)) return;

    closeEventEditor();
    if (onCloseFloatingDetail?.() === false) return;
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }

    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(null);
    if (directDateAction && dateKey) onDirectDateAction?.(dateKey);
  }

  function handleSelectItem(
    day,
    itemId,
    dateKey = null,
    { keepOverflowOpen = false, anchorMeta = null } = {},
  ) {
    if (
      floatingEditorOpen
      && selectedItemId != null
      && String(itemId) === String(selectedItemId)
      && (!floatingDetailDateKey || !dateKey || dateKey === floatingDetailDateKey)
    ) {
      return;
    }
    if (floatingEditorDirty) {
      onShakeFloatingEditor?.();
      return;
    }
    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }
    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    if (keepOverflowOpen) {
      markOverflowInteraction();
    }
    if (dateKey) onDirectItemAction?.(itemId, dateKey);
    if (!keepOverflowOpen) {
      setOverflowState(null);
    }
    if (!layout.stacked && anchorMeta?.triggerElement) {
      onOpenFloatingDetail?.({
        view,
        itemId: itemId != null ? String(itemId) : null,
        dateKey: anchorMeta.dateKey || dateKey || null,
        day,
        anchorElement: anchorMeta.triggerElement,
        sourceCellElement:
          anchorMeta.sourceCellElement ||
          anchorMeta.triggerElement.closest?.("[role='gridcell']") ||
          null,
        exclusionElement: anchorMeta.exclusionElement || null,
        anchorKind: anchorMeta.anchorKind || "chip",
        itemsSnapshot: anchorMeta.itemsSnapshot || null,
      });
    }
  }

  function handleSelectSpanSegment(segment, { triggerElement, dateKey }) {
    if (!segment?.item || !segment.eventId) return;
    const requestedDateKey = dateKey || segment.segmentStart;
    const parsed = parseYmd(requestedDateKey);
    const nextDay = parsed?.day || selectedDay;
    const nextDateKey = parsed ? requestedDateKey : segment.segmentStart;
    const sourceCellElement = nextDateKey
      ? gridShellRef.current?.querySelector?.(
          `[role='gridcell'][data-date-key='${nextDateKey}']`,
        ) || null
      : null;
    handleSelectItem(nextDay, getEventSelectionId(segment.item), nextDateKey, {
      keepOverflowOpen:
        sameOverflowDate(resolvedOverflow, nextDateKey, nextDay) ||
        spanCoversOverflowDate(resolvedOverflow, segment),
      anchorMeta: {
        triggerElement,
        sourceCellElement,
        anchorKind: "span",
        itemsSnapshot: [segment.item],
      },
    });
  }

  useCalendarGridEffects({
    activeMonthWheelStateRef,
    canGoPrev,
    closeOverflow,
    floatingDetailDateKey,
    floatingDetailMode,
    floatingDetailOpen,
    floatingDetailParked,
    gridShellRef,
    ignoreOverflowScrollUntilRef,
    layout,
    navigateMonth,
    onReanchorFloatingDetail,
    resolvedOverflow,
    selectedDateKey,
    selectedDay,
    selectedItemId,
    setOverflowState,
    suppressOutsideClick,
    view,
    viewMonth,
    viewYear,
  });

  return (
    <div
      ref={gridShellRef}
      data-testid="calendar-grid-shell"
      style={{
        minWidth: 0,
        width: "100%",
        flex: 1,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
    >
      <CalendarGridWeekHeader gap={layout.weekHeaderGap} />

      <div
        ref={gridBodyRef}
        style={{ position: "relative", flex: 1, minHeight: 0 }}
      >
        <div
          data-testid="calendar-grid-month"
          role="grid"
          aria-label={`${activeView.label || view} calendar for ${new Date(
            viewYear,
            viewMonth,
          ).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}`}
          key={`${view}-${viewYear}-${viewMonth}`}
          data-month-motion={
            monthMotionDirection > 0
              ? "next"
              : monthMotionDirection < 0
                ? "prev"
                : "none"
          }
          style={{
            position: "relative",
            height: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gridTemplateRows: fillGridHeight
              ? `repeat(${gridRowCount}, minmax(0, 1fr))`
              : `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
            gap: layout.gridGap,
            animation:
              monthMotionDirection > 0
                ? "calendarMonthSlideNext 170ms cubic-bezier(0.16, 1, 0.3, 1)"
                : monthMotionDirection < 0
                  ? "calendarMonthSlidePrev 170ms cubic-bezier(0.16, 1, 0.3, 1)"
                  : "none",
            willChange: monthMotionDirection ? "transform, opacity" : "auto",
          }}
        >
          {monthCells.map((cell) => {
            const day = cell.day;
            const rawItems =
              itemsByDate?.[cell.dateKey] ??
              (cell.inCurrentMonth ? itemsByDay[day] : null) ??
              [];
            const dayState =
              activeView.getDayState?.(rawItems) ??
              buildFallbackDayState(rawItems);
            const filteredDeadlineDayState = shouldFilterCompletedDeadlines
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
            const cellGhosts = getCellGhosts(ghostPreview, cell.dateKey);
            const cellMeta = cellMetaByDate?.[cell.dateKey] || null;
            const resolvedDayState = filteredDeadlineDayState;
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
            const resolvedSelectionPool = selectionPool;
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
              resolvedSelectionPool.some(
                (item) =>
                  String(resolveItemId(item)) === String(selectedItemId),
              );
            const anchorKey = `${view}-${cell.dateKey || `${viewYear}-${viewMonth}-${day}`}`;
            const overflowOpen = sameOverflowDate(
              resolvedOverflow,
              cell.dateKey,
              day,
            );
            const inlineOverflowOpen =
              overflowOpen && resolvedOverflow?.mode === "inline";

            return (
              <CalendarCell
                key={cell.dateKey || day}
                view={view}
                viewYear={viewYear}
                viewMonth={viewMonth}
                viewLabel={activeView.label || view}
                day={day}
                dateKey={cell.dateKey}
                dateLabel={cell.dateLabel}
                inCurrentMonth={cell.inCurrentMonth}
                boundarySides={cell.boundarySides}
                items={cellItems}
                ghosts={cellGhosts}
                cellMeta={cellMeta}
                selectedItemId={dayHasSelectedItem ? selectedItemId : null}
                itemCount={
                  resolvedDayState.totalCount +
                  cellGhosts.length +
                  pinnedGhostCount
                }
                hasItems={hasItems}
                isToday={isToday}
                isSelected={isSelected}
                pastTone={pastTone}
                hasOverdue={hasOverdue}
                allComplete={allComplete}
                loading={viewData?.isLoading}
                overflowOpen={overflowOpen}
                overflowMode={overflowOpen ? resolvedOverflow?.mode : null}
                onSelectDay={() =>
                  handleSelectDay(day, isSelected, cell.dateKey)
                }
                onSelectDateHeader={() =>
                  handleSelectDay(day, isSelected, cell.dateKey, {
                    clearItemSelection: true,
                    directDateAction: false,
                  })
                }
                onSelectItem={(itemId, anchorMeta) =>
                  handleSelectItem(day, itemId, cell.dateKey, {
                    keepOverflowOpen: overflowOpen,
                    anchorMeta,
                  })
                }
                onOpenOverflow={({
                  triggerElement,
                  hiddenItems,
                  totalCount,
                  visibleCount,
                  hiddenStackHeight,
                }) => {
                  const sourceCellElement =
                    triggerElement?.closest?.("[role='gridcell']");
                  setOverflowState((current) => {
                    if (current?.anchorKey === anchorKey) {
                      return null;
                    }
                    const mode = canUseInlineOverflow({
                      triggerElement,
                      hiddenStackHeight,
                      layout,
                    })
                      ? "inline"
                      : "fallback";
                    const inlineAnchor =
                      mode === "inline"
                        ? resolveInlineOverflowAnchor(
                            triggerElement,
                            gridBodyRef.current,
                          )
                        : null;
                    return {
                      mode,
                      triggerElement,
                      sourceCellElement,
                      inlineAnchor,
                      boundarySides: cell.boundarySides,
                      boundaryColor: cell.boundaryColor,
                      items: hiddenItems,
                      totalCount,
                      visibleCount,
                      label: new Date(
                        `${cell.dateKey}T00:00:00`,
                      ).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      }),
                      viewLabel:
                        activeView.label ||
                        view[0].toUpperCase() + view.slice(1),
                      day,
                      dateKey: cell.dateKey,
                      view,
                      viewYear,
                      viewMonth,
                      anchorKey,
                      hiddenSignature: overflowHiddenSignature(hiddenItems),
                    };
                  });
                }}
                renderCellContents={(args) =>
                  activeView.renderCellContents?.({
                    ...args,
                    overflowOpen,
                    overflowAnchorKey: anchorKey,
                    inlineOverflowOpen,
                    inlineOverflowVisibleCount: inlineOverflowOpen
                      ? resolvedOverflow?.visibleCount
                      : null,
                    inlineOverflowExternal: true,
                    onInlineOverflowInteraction: markOverflowInteraction,
                    onCloseInlineOverflow: closeOverflowWithoutFocus,
                    onHiddenItemsChange: validateOverflowHiddenItems,
                    onBeforeItemAction: onCloseFloatingDetail,
                    pinnedIds: eventDateCells ? spanLayout.pinnedIds : null,
                    reservedLaneCount,
                    layout,
                  })
                }
                quickActions={itemQuickActions}
              />
            );
          })}
        </div>
        <CalendarMonthBoundaryOverlay
          monthCells={monthCells}
          layout={layout}
          gridRowCount={gridRowCount}
          fillGridHeight={fillGridHeight}
          suppressedBoundary={
            resolvedOverflow?.mode === "inline" &&
            resolvedOverflow.boundarySides?.includes?.("bottom")
              ? { dateKey: resolvedOverflow.dateKey, sides: ["bottom"] }
              : null
          }
        />
        <CalendarEventSpanOverlay
          segments={spanLayout.spanSegments}
          layout={layout}
          gridRowCount={gridRowCount}
          fillGridHeight={fillGridHeight}
          selectedItemId={selectedItemId}
          activeSegmentId={activeSpanSegmentId}
          onSetActive={setActiveSpanSegmentId}
          onClearActive={(segmentId) => {
            setActiveSpanSegmentId((current) =>
              current === segmentId ? null : current,
            );
          }}
          onSelectSegment={handleSelectSpanSegment}
          quickActions={eventDateCells ? eventQuickActions : null}
          onBeforeAction={onCloseFloatingDetail}
        />
        {resolvedOverflow?.mode === "inline" ? (
          <CalendarInlineOverflowLayer
            overflow={resolvedOverflow}
            selectedItemId={selectedItemId}
            onSelectItem={(itemId, anchorMeta) => {
              if (resolvedOverflow?.day == null) return;
              handleSelectItem(
                resolvedOverflow.day,
                itemId,
                resolvedOverflow.dateKey || null,
                { keepOverflowOpen: true, anchorMeta },
              );
            }}
            onInteraction={markOverflowInteraction}
            quickActions={itemQuickActions}
            onBeforeItemAction={onCloseFloatingDetail}
          />
        ) : null}

        {showGridSkeleton && (
          <CalendarGridSkeleton
            firstDay={firstDay}
            daysInMonth={daysInMonth}
            trailingEmpty={resolvedTrailingEmpty}
            cellHeight={layout.cellHeight}
            gridGap={layout.gridGap}
            fillHeight={fillGridHeight}
            rowCount={gridRowCount}
          />
        )}
      </div>

      <CalendarCellOverflowPopover
        popover={resolvedPopover}
        selectedItemId={selectedItemId}
        onSelectItem={(itemId, anchorMeta) => {
          if (resolvedPopover?.day == null) return;
          handleSelectItem(
            resolvedPopover.day,
            itemId,
            resolvedPopover.dateKey || null,
            { keepOverflowOpen: true, anchorMeta },
          );
        }}
        onClose={() => setOverflowState(null)}
        onOverflowInteraction={markOverflowInteraction}
        suppressOutsideClick={suppressOutsideClick}
        quickActions={itemQuickActions}
        onBeforeItemAction={onCloseFloatingDetail}
        floatingDetailOpen={floatingDetailOpen}
      />
    </div>
  );
}
