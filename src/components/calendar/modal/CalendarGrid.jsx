import { memo, useEffect, useMemo, useRef, useState } from "react";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import { parseYmd } from "../calendarDateUtils.js";
import {
  buildCalendarEventSpanLayout,
  isPinnedCalendarGhost,
} from "./calendarEventSpanLayout.js";
import { getEventSelectionId } from "../../../lib/shell-helpers";
import CalendarGridCells from "./CalendarGridCells.jsx";
import CalendarGridLayers from "./CalendarGridLayers.jsx";
import CalendarGridSkeleton from "./CalendarGridSkeleton.jsx";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader.jsx";
import useCalendarGridEffects from "./useCalendarGridEffects.js";
import useCalendarGridOverflow from "./useCalendarGridOverflow.js";
import {
  buildCalendarMonthCells,
  sameOverflowDate,
  spanCoversOverflowDate,
} from "./calendarGridUtils.js";
import { renderedRows } from "../../../hooks/calendar/calendarGridRowModel.js";

export default memo(function CalendarGrid({
  view,
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  todayDate,
  firstDay,
  daysInMonth,
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
  eventQuickActions,
  deadlineQuickActions,
  ghostPreview,
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  floatingDetailOpen = false,
  floatingDetailItemId = null,
  floatingDetailMode = null,
  floatingDetailDateKey = null,
  floatingEditorDirty = false,
  onCancelFloatingEditor,
  onShakeFloatingEditor,
  onDirectDateAction,
  onDirectItemAction,
  showWeekHeader = true,
  isActiveMonth = true,
  previewEvents = null,
  previewDeadlineOverlay = null,
}) {
  const gridShellRef = useRef(null);
  const gridBodyRef = useRef(null);
  const [activeSpanSegmentId, setActiveSpanSegmentId] = useState(null);
  const weekRows = renderedRows(viewYear, viewMonth);
  const resolvedTrailingEmpty = Math.max(0, weekRows * 7 - firstDay - daysInMonth);
  const gridSelectedDateKey = selectedDateKey;
  const floatingDetailSelectionItemId = floatingDetailOpen
    && floatingDetailMode === "detail"
    && floatingDetailItemId != null
    ? String(floatingDetailItemId)
    : null;
  const gridSelectedItemId = selectedItemId ?? floatingDetailSelectionItemId;
  const eventDateCells = view === "events";
  const shouldFilterCompletedDeadlines = false;
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
  const itemQuickActions = eventDateCells ? eventsPlanningQuickActions : null;
  const selectedCellKey = gridSelectedDateKey;
  const currentSelectionKey = gridSelectedDateKey && gridSelectedItemId != null
    ? `${gridSelectedDateKey}:${gridSelectedItemId}`
    : null;
  const {
    clearSuppressedSelectedHiddenAutoOpenKey,
    closeOverflow,
    closeOverflowWithoutFocus,
    handleOpenOverflow,
    ignoreOverflowScrollUntilRef,
    markOverflowInteraction,
    resolvedOverflow,
    resolvedPopover,
    setOverflowState,
    suppressedSelectedHiddenAutoOpenKey,
    validateOverflowHiddenItems,
  } = useCalendarGridOverflow({
    activeView,
    currentMonth,
    currentYear,
    currentSelectionKey,
    enabled: true,
    gridBodyRef,
    gridSelectedItemId,
    gridShellRef,
    layout,
    view,
    viewMonth,
    viewYear,
  });
  const floatingEditorOpen = floatingDetailMode === "edit" || floatingDetailMode === "create";

  // The cell slots bail out via sameCalendarGridCellSlotProps, which compares
  // only data props — handlers passed through them can execute closures from
  // an older render. Volatile interaction state must be read through this ref
  // (synced every render), never captured, or a bailed-out cell acts on stale
  // editor/selection/overflow state.
  const interactionStateRef = useRef(null);
  useEffect(() => {
    interactionStateRef.current = {
      floatingEditorOpen,
      floatingDetailMode,
      floatingDetailDateKey,
      floatingEditorDirty,
      selectedItemId,
      resolvedOverflow,
      suppressedSelectedHiddenAutoOpenKey,
    };
  });

  const eventCellCount = weekRows * 7;
  const monthCells = useMemo(
    () => buildCalendarMonthCells({
      cellCount: eventCellCount,
      currentMonth,
      currentYear,
      firstDay,
      viewMonth,
      viewYear,
    }),
    [eventCellCount, currentMonth, currentYear, firstDay, viewMonth, viewYear],
  );

  const previewComputed = useMemo(() => {
    if (isActiveMonth) return null;
    // Month-agnostic views (bills) render every mounted month from the single
    // shared itemsByDate, so they must not run the per-month events/deadlines
    // preview compute — feeding events-shaped data to bills' compute yields an
    // empty itemsByDate that would shadow the shared map and blank the month.
    if (activeView.monthAgnosticItemsByDate) return null;
    if (!previewEvents?.length && !previewDeadlineOverlay?.data) return null;
    if (typeof activeView.compute !== "function") return null;
    return activeView.compute({
      data: {
        events: previewEvents || [],
        deadlineOverlay: previewDeadlineOverlay,
      },
      viewYear,
      viewMonth,
    });
  }, [isActiveMonth, previewEvents, previewDeadlineOverlay, activeView, viewYear, viewMonth]);

  const resolvedItemsByDate = previewComputed?.itemsByDate || itemsByDate;
  const resolvedItemsByDay = previewComputed?.itemsByDay || itemsByDay;

  const resolvedEvents = viewData?.events || previewEvents || emptyEvents;
  const spanLayoutGhosts = useStableSpanLayoutGhosts(ghostPreview?.ghosts);
  const spanLayout = useMemo(() => {
    if (view !== "events") {
      return {
        spanSegments: [],
        pinnedByDate: {},
        reservedLaneCountByDate: {},
        pinnedGhostCountByDate: {},
        pinnedIds: new Set(),
        pinnedIdsByDate: {},
        pinnedOverflowByDate: {},
      };
    }
    return buildCalendarEventSpanLayout({
      monthCells,
      events: resolvedEvents,
      ghosts: spanLayoutGhosts,
      layout,
    });
  }, [layout, monthCells, resolvedEvents, spanLayoutGhosts, view]);

  function handleSelectDay(
    day,
    isSelected,
    dateKey = null,
    { clearItemSelection = false, directDateAction = true } = {},
  ) {
    const interaction = interactionStateRef.current;
    if (
      interaction.floatingEditorOpen
      && interaction.floatingDetailDateKey
      && dateKey === interaction.floatingDetailDateKey
      && interaction.selectedItemId == null
    ) {
      return;
    }
    if (interaction.floatingEditorDirty) {
      onShakeFloatingEditor?.();
      return;
    }
    const isOverflowSourceDay = sameOverflowDate(
      interaction.resolvedOverflow,
      dateKey,
      day,
    );
    if (!isOverflowSourceDay) setOverflowState(null);
    if (isSelected && (!clearItemSelection || interaction.selectedItemId == null)) return;

    closeEventEditor();
    if (interaction.floatingEditorOpen && interaction.floatingDetailMode === "create" && onCancelFloatingEditor) {
      onCancelFloatingEditor();
    } else if (onCloseFloatingDetail?.() === false) {
      return;
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
    const interaction = interactionStateRef.current;
    if (
      interaction.floatingEditorOpen
      && interaction.selectedItemId != null
      && String(itemId) === String(interaction.selectedItemId)
      && (!interaction.floatingDetailDateKey || !dateKey || dateKey === interaction.floatingDetailDateKey)
    ) {
      return;
    }
    if (interaction.floatingEditorDirty) {
      onShakeFloatingEditor?.();
      return;
    }
    closeEventEditor();
    if (eventDateCells && !anchorMeta?.preserveEventSelection) eventQuickActions?.clearEventSelection?.();
    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    const nextSelectionKey = dateKey && itemId != null ? `${dateKey}:${itemId}` : null;
    if (nextSelectionKey !== interaction.suppressedSelectedHiddenAutoOpenKey) {
      clearSuppressedSelectedHiddenAutoOpenKey();
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
        view,
        detailKind: anchorMeta.detailKind || null,
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
    enabled: isActiveMonth,
    overflowInteractionEnabled: true,
    closeOverflow,
    floatingDetailOpen,
    gridShellRef,
    ignoreOverflowScrollUntilRef,
    eventSelectionActive: !!eventQuickActions?.eventSelectionActive,
    resolvedOverflow,
    setOverflowState,
    suppressOutsideClick,
  });

  return (
    <div
      ref={gridShellRef}
      data-testid={isActiveMonth ? "calendar-grid-shell" : undefined}
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
      {showWeekHeader ? <CalendarGridWeekHeader gap={layout.weekHeaderGap} /> : null}

      <div
        ref={gridBodyRef}
        style={{ position: "relative", flex: 1, minHeight: 0 }}
      >
        <div
          data-testid={isActiveMonth ? "calendar-grid-month" : undefined}
          role="grid"
          aria-label={`${activeView.label || view} calendar for ${new Date(
            viewYear,
            viewMonth,
          ).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}`}
          key={`${view}-${viewYear}-${viewMonth}`}
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "1fr",
            gridTemplateRows: `repeat(${weekRows}, ${layout.cellHeight}px)`,
            gap: layout.gridGap,
          }}
        >
          <CalendarGridCells
            activeView={activeView}
            buildFallbackDayState={buildFallbackDayState}
            isActiveMonth={isActiveMonth}
            cellMetaByDate={cellMetaByDate}
            currentMonth={currentMonth}
            currentYear={currentYear}
            eventDateCells={eventDateCells}
            ghostPreview={ghostPreview}
            itemQuickActions={itemQuickActions}
            itemsByDate={resolvedItemsByDate}
            itemsByDay={resolvedItemsByDay}
            layout={layout}
            monthCells={monthCells}
            onBeforeItemAction={onCloseFloatingDetail}
            onCloseInlineOverflow={closeOverflowWithoutFocus}
            onHiddenItemsChange={validateOverflowHiddenItems}
            onInlineOverflowInteraction={markOverflowInteraction}
            onOpenOverflow={handleOpenOverflow}
            onSelectDay={handleSelectDay}
            onSelectItem={handleSelectItem}
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
          firstDay={firstDay}
          weekRows={weekRows}
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
});

const emptyEvents = [];

function useStableSpanLayoutGhosts(ghosts) {
  const signature = spanLayoutGhostSignature(ghosts);
  return useMemo(() => (
    signature ? JSON.parse(signature) : emptyEvents
  ), [signature]);
}

function selectSpanLayoutGhosts(ghosts) {
  const pinnedGhosts = (ghosts || []).filter((ghost) => (
    ghost?.kind === "event" && isPinnedCalendarGhost(ghost)
  ));
  return pinnedGhosts.length ? pinnedGhosts : emptyEvents;
}

function spanLayoutGhostSignature(ghosts) {
  const pinnedGhosts = selectSpanLayoutGhosts(ghosts);
  if (!pinnedGhosts.length) return "";
  return JSON.stringify(pinnedGhosts.map((ghost) => ({
    id: ghost?.id || "",
    kind: "event",
    title: ghost?.title || "",
    startDate: ghost?.startDate || "",
    endDate: ghost?.endDate || "",
    startTime: ghost?.startTime || "",
    endTime: ghost?.endTime || "",
    allDay: !!ghost?.allDay,
    color: ghost?.color || "",
    sourceColor: ghost?.sourceColor || "",
    isRecurring: !!ghost?.isRecurring,
    recurring: !!ghost?.recurring,
    startMs: ghost?.startMs || null,
  })));
}
