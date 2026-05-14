import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import { parseYmd } from "../calendarDateUtils.js";
import { buildCalendarEventSpanLayout } from "./calendarEventSpanLayout.js";
import { getEventSelectionId } from "../../../lib/redesign-helpers";
import CalendarGridCells from "./CalendarGridCells.jsx";
import CalendarGridLayers from "./CalendarGridLayers.jsx";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader.jsx";
import useCalendarGridEffects from "./useCalendarGridEffects.js";
import {
  GRID_ROWS,
  buildCalendarMonthCells,
  createMonthWheelState,
  overflowStateIsLiveInScope,
  overflowHiddenSignature,
  resolveOverflowPresentation,
  sameOverflowDate,
  spanCoversOverflowDate,
} from "./calendarGridUtils.js";

function overflowItemMatchesId(item, itemId) {
  if (itemId == null) return false;
  const target = String(itemId);
  if (String(item?.id) === target) return true;
  if (item?.selectionId != null && String(item.selectionId) === target) return true;
  return (item?.matchItemIds || []).some((id) => String(id) === target);
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
  floatingDetailAnchorElement = null,
  floatingDetailAnchorKind = null,
  floatingDetailOpen = false,
  floatingDetailParked = false,
  floatingDetailItemId = null,
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
  const [suppressedSelectedHiddenAutoOpenKey, setSuppressedSelectedHiddenAutoOpenKey] = useState(null);
  const [overflowReanchorDateKey, setOverflowReanchorDateKey] = useState(null);
  const fillGridHeight = !layout.stacked;
  const gridRowCount = fillGridHeight
    ? Math.max(1, Math.ceil((firstDay + daysInMonth) / 7))
    : GRID_ROWS;
  const resolvedTrailingEmpty = fillGridHeight
    ? Math.max(0, gridRowCount * 7 - firstDay - daysInMonth)
    : trailingEmpty;
  const [overflowState, setOverflowState] = useState(null);
  const resolvedOverflow =
    overflowStateIsLiveInScope(overflowState, { view, viewYear, viewMonth })
      ? overflowState
      : null;
  const resolvedPopover =
    resolvedOverflow?.mode === "fallback" ? resolvedOverflow : null;
  const gridSelectedDateKey =
    floatingDetailParked && floatingDetailDateKey
      ? floatingDetailDateKey
      : selectedDateKey;
  const gridSelectedItemId = floatingDetailParked
    ? (floatingDetailItemId != null ? String(floatingDetailItemId) : null)
    : selectedItemId;
  const eventDateCells = view === "events";
  const shouldFilterCompletedDeadlines = view === "deadlines" && !showCompletedDeadlines;
  const eventsPlanningQuickActions = useMemo(() => {
    if (!eventDateCells) return null;
    return {
      ...eventQuickActions,
      openContextMenu: (payload) => {
        if (payload?.item?.itemKind === "deadline") return deadlineQuickActions?.openContextMenu?.(payload);
        return eventQuickActions?.openContextMenu?.(payload);
      },
    };
  }, [deadlineQuickActions, eventDateCells, eventQuickActions]);
  const itemQuickActions = eventDateCells ? eventsPlanningQuickActions : view === "deadlines" ? deadlineQuickActions : null;
  const selectedCellKey = gridSelectedDateKey;
  const currentSelectionKey = gridSelectedDateKey && gridSelectedItemId != null
    ? `${gridSelectedDateKey}:${gridSelectedItemId}`
    : null;
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
      if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
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
    [currentSelectionKey, overflowState?.anchorKey, setOverflowState],
  );
  const closeOverflowWithoutFocus = useCallback(() => {
    if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
    setOverflowState(null);
  }, [currentSelectionKey, setOverflowState]);
  useEffect(() => {
    function handleOverflowCloseRequest() {
      if (currentSelectionKey) setSuppressedSelectedHiddenAutoOpenKey(currentSelectionKey);
      setOverflowState(null);
    }
    document.addEventListener("calendar-overflow-close", handleOverflowCloseRequest);
    return () => document.removeEventListener("calendar-overflow-close", handleOverflowCloseRequest);
  }, [currentSelectionKey, setOverflowState]);
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
        && current.leadingColumnWidth === composition.leadingColumnWidth
      ) {
        return current;
      }
      const keepOpenItemId = current.keepOpenItemId ?? gridSelectedItemId;
      if (
        keepOpenItemId != null
        && (composition.hiddenItems || []).some((item) => overflowItemMatchesId(item, keepOpenItemId))
      ) {
        return {
          ...current,
          items: composition.hiddenItems,
          hiddenSignature: nextSignature,
          totalCount: composition.totalCount,
          visibleCount: composition.visibleCount,
          leadingColumnWidth: composition.leadingColumnWidth,
          keepOpenItemId: String(keepOpenItemId),
        };
      }
      return null;
    });
  }, [gridSelectedItemId, setOverflowState]);
  const markOverflowInteraction = useCallback(() => {
    ignoreOverflowScrollUntilRef.current = performance.now() + 220;
  }, []);
  const clearOverflowReanchorRequest = useCallback((dateKey) => {
    setOverflowReanchorDateKey((current) => (
      !dateKey || current === dateKey ? null : current
    ));
  }, []);
  const handleReanchorFloatingDetail = useCallback((payload) => {
    if (payload?.day != null) {
      setSelectedDay?.(payload.day);
    }
    if (payload?.dateKey) {
      setSelectedDateKey?.(payload.dateKey);
    }
    if (payload?.itemId != null) {
      setSelectedItemId?.(String(payload.itemId));
      if (payload.dateKey) {
        onDirectItemAction?.(payload.itemId, payload.dateKey);
      }
    } else if (payload?.mode !== "detail") {
      setSelectedItemId?.(null);
      if (payload?.dateKey) {
        onDirectDateAction?.(payload.dateKey);
      }
    }
    onReanchorFloatingDetail?.(payload);
  }, [
    onDirectDateAction,
    onDirectItemAction,
    onReanchorFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
  ]);

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
    if (eventDateCells) eventQuickActions?.clearEventSelection?.();

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
    if (eventDateCells && !anchorMeta?.preserveEventSelection) eventQuickActions?.clearEventSelection?.();
    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    const nextSelectionKey = dateKey && itemId != null ? `${dateKey}:${itemId}` : null;
    if (nextSelectionKey !== suppressedSelectedHiddenAutoOpenKey) {
      setSuppressedSelectedHiddenAutoOpenKey(null);
    }
    if (keepOverflowOpen) {
      markOverflowInteraction();
      if (itemId != null) {
        setOverflowState((current) => {
          if (!sameOverflowDate(current, dateKey, day)) return current;
          return {
            ...current,
            keepOpenItemId: String(itemId),
          };
        });
      }
    }
    if (dateKey) onDirectItemAction?.(itemId, dateKey);
    if (!keepOverflowOpen) {
      setOverflowState(null);
    }
    if (!layout.stacked && anchorMeta?.triggerElement) {
      onOpenFloatingDetail?.({
        view: anchorMeta.detailView || view,
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

  const handleOpenOverflow = useCallback(({
    triggerElement,
    hiddenItems,
    totalCount,
    visibleCount,
    hiddenStackHeight,
    leadingColumnWidth,
    focusOnOpen,
    forceOpen,
    reanchorItemId,
    anchorKey,
    cell,
    day,
  }) => {
    const sourceCellElement =
      triggerElement?.closest?.("[role='gridcell']");
    setOverflowState((current) => {
      if (current?.anchorKey === anchorKey) {
        const sameLiveOverflow = overflowStateIsLiveInScope(current, {
          view,
          viewYear,
          viewMonth,
        });
        if (sameLiveOverflow) {
          if (!forceOpen) return null;
          if (reanchorItemId == null) return current;
          return {
            ...current,
            keepOpenItemId: String(reanchorItemId),
          };
        }
      }
      const presentation = resolveOverflowPresentation({
        triggerElement,
        hiddenStackHeight,
        layout,
        containerElement: gridBodyRef.current,
      });
      if (!presentation) return current;
      return {
        mode: presentation.mode,
        triggerElement,
        sourceCellElement,
        inlineAnchor: presentation.inlineAnchor,
        boundarySides: cell.boundarySides,
        boundaryColor: cell.boundaryColor,
        items: hiddenItems,
        totalCount,
        visibleCount,
        leadingColumnWidth,
        focusOnOpen: focusOnOpen ?? true,
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
        keepOpenItemId: forceOpen && reanchorItemId != null ? String(reanchorItemId) : null,
      };
    });
  }, [activeView.label, layout, view, viewMonth, viewYear]);
  const openOverflowForReanchor = useCallback((dateKey) => {
    if (!dateKey || resolvedOverflow?.dateKey === dateKey) return false;
    if (overflowReanchorDateKey === dateKey) return true;
    const trigger = gridShellRef.current?.querySelector?.(
      `[role='gridcell'][data-date-key='${dateKey}'] [data-calendar-overflow-trigger='true']`,
    );
    if (!trigger) return false;
    markOverflowInteraction();
    setOverflowReanchorDateKey(dateKey);
    return true;
  }, [markOverflowInteraction, overflowReanchorDateKey, resolvedOverflow?.dateKey]);

  useCalendarGridEffects({
    activeMonthWheelStateRef,
    canGoPrev,
    closeOverflow,
    floatingDetailAnchorElement,
    floatingDetailAnchorKind,
    floatingDetailDateKey,
    floatingDetailItemId,
    floatingDetailMode,
    floatingDetailOpen,
    floatingDetailParked,
    gridShellRef,
    ignoreOverflowScrollUntilRef,
    layout,
    eventSelectionActive: !!eventQuickActions?.eventSelectionActive,
    navigateMonth,
    onOpenOverflowForReanchor: openOverflowForReanchor,
    onRefreshFloatingDetailAnchor: onReanchorFloatingDetail,
    onReanchorFloatingDetail: handleReanchorFloatingDetail,
    resolvedOverflow,
    selectedDateKey: gridSelectedDateKey,
    selectedDay,
    selectedItemId: gridSelectedItemId,
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
          <CalendarGridCells
            activeView={activeView}
            buildFallbackDayState={buildFallbackDayState}
            cellMetaByDate={cellMetaByDate}
            currentMonth={currentMonth}
            currentYear={currentYear}
            eventDateCells={eventDateCells}
            ghostPreview={ghostPreview}
            itemQuickActions={itemQuickActions}
            itemsByDate={itemsByDate}
            itemsByDay={itemsByDay}
            layout={layout}
            monthCells={monthCells}
            onBeforeItemAction={onCloseFloatingDetail}
            onCloseInlineOverflow={closeOverflowWithoutFocus}
            onHiddenItemsChange={validateOverflowHiddenItems}
            onInlineOverflowInteraction={markOverflowInteraction}
            onOpenOverflow={handleOpenOverflow}
            onOverflowReanchorRequestHandled={clearOverflowReanchorRequest}
            onSelectDay={handleSelectDay}
            onSelectItem={handleSelectItem}
            overflowReanchorDateKey={overflowReanchorDateKey}
            resolvedOverflow={resolvedOverflow}
            selectedCellKey={selectedCellKey}
            selectedDay={selectedDay}
            selectedItemId={gridSelectedItemId}
            shouldFilterCompletedDeadlines={shouldFilterCompletedDeadlines}
            spanLayout={spanLayout}
            suppressedSelectedHiddenAutoOpenKey={suppressedSelectedHiddenAutoOpenKey}
            todayDate={todayDate}
            view={view}
            viewData={viewData}
            viewMonth={viewMonth}
            viewYear={viewYear}
          />
        </div>
        <CalendarGridLayers
          activeSpanSegmentId={activeSpanSegmentId}
          daysInMonth={daysInMonth}
          eventDateCells={eventDateCells}
          eventQuickActions={eventQuickActions}
          fillGridHeight={fillGridHeight}
          firstDay={firstDay}
          gridRowCount={gridRowCount}
          itemQuickActions={itemQuickActions}
          layout={layout}
          monthCells={monthCells}
          onBeforeItemAction={onCloseFloatingDetail}
          onClearActiveSpanSegment={(segmentId) => {
            setActiveSpanSegmentId((current) =>
              current === segmentId ? null : current,
            );
          }}
          onInlineOverflowInteraction={markOverflowInteraction}
          onSelectInlineOverflowItem={(itemId, anchorMeta) => {
            if (resolvedOverflow?.day == null) return;
            handleSelectItem(
              resolvedOverflow.day,
              itemId,
              resolvedOverflow.dateKey || null,
              { keepOverflowOpen: true, anchorMeta },
            );
          }}
          onSelectSpanSegment={handleSelectSpanSegment}
          onSetActiveSpanSegment={setActiveSpanSegmentId}
          resolvedOverflow={resolvedOverflow}
          resolvedTrailingEmpty={resolvedTrailingEmpty}
          selectedItemId={gridSelectedItemId}
          showGridSkeleton={showGridSkeleton}
          spanSegments={spanLayout.spanSegments}
        />
      </div>

      <CalendarCellOverflowPopover
        popover={resolvedPopover}
        selectedItemId={gridSelectedItemId}
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
