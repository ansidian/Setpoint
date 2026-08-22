import { memo, useEffect, useMemo, useRef, useState } from "react";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover";
import { parseYmd } from "../calendarDateUtils.ts";
import {
  buildCalendarEventSpanLayout,
  calendarSpanLayoutGhostSignature,
  calendarSpanLayoutGhostsFromSignature,
} from "./calendarEventSpanLayout";
import { getEventSelectionId } from "../../../lib/shell-helpers";
import CalendarGridCells from "./CalendarGridCells";
import CalendarGridLayers from "./CalendarGridLayers";
import CalendarGridWeekHeader from "./CalendarGridWeekHeader";
import useCalendarGridEffects from "./useCalendarGridEffects";
import useCalendarGridOverflow from "./useCalendarGridOverflow";
import {
  buildCalendarMonthCells,
  sameOverflowDate,
  spanCoversOverflowDate,
} from "./calendarGridUtils";
import { renderedRows } from "../../../hooks/calendar/calendarGridRowModel";
import type { CalendarCellQuickActions, CalendarCellWeather } from "./CalendarCell";
import type {
  CalendarGridActiveView,
  CalendarGridDayState,
  CalendarGridItemLike,
} from "./calendarGridCellModel";
import type {
  CalendarEventSpanLayout,
  CalendarSpanEvent,
  CalendarSpanSegment,
} from "./calendarEventSpanLayout";
import type { CalendarGhostLike } from "./calendarGridUtils";
import type { CalendarGridOverflowState } from "./useCalendarGridOverflow";
import {
  buildCalendarMonthPreviewComputed,
  mergeAdjacentEventLists,
  type CalendarDeadlineOverlay,
} from "./calendarMonthPreviewModel";

export interface CalendarGridLayout {
  cellHeight: number;
  gridGap: number;
  weekHeaderGap: number;
  stacked?: boolean;
  tier?: "uhd" | "xl" | "lg" | "md" | "sm";
}

export interface CalendarGridActiveViewContract extends CalendarGridActiveView {
  label?: string;
  monthAgnosticItemsByDate?: boolean;
  compute?: (options: {
    data: { events: CalendarSpanEvent[]; deadlineOverlay: unknown };
    viewYear: number;
    viewMonth: number;
  }) => {
    itemsByDate?: Record<string, CalendarGridItemLike[]>;
    itemsByDay?: Record<number, CalendarGridItemLike[]>;
  };
  renderCellContents?: (...args: never[]) => React.ReactNode;
}

export interface CalendarGridFloatingAnchorMeta {
  preserveEventSelection?: boolean;
  triggerElement?: HTMLElement | null;
  sourceCellElement?: Element | null;
  exclusionElement?: Element | null;
  detailKind?: string | null;
  dateKey?: string | null;
  anchorKind?: string;
  itemsSnapshot?: unknown[] | null;
}

export interface CalendarGridProps {
  view: string;
  viewYear: number;
  viewMonth: number;
  currentYear: number;
  currentMonth: number;
  todayDate: number;
  firstDay: number;
  daysInMonth: number;
  trailingEmpty?: number;
  itemsByDay: Record<number, CalendarGridItemLike[]>;
  itemsByDate?: Record<string, CalendarGridItemLike[]>;
  cellMetaByDate?: Record<string, { weather?: CalendarCellWeather | null }>;
  selectedDay?: number | null;
  selectedDateKey?: string | null;
  selectedItemId?: unknown;
  viewData?: { events?: CalendarSpanEvent[]; deadlineOverlay?: CalendarDeadlineOverlay | null; isLoading?: boolean } | null;
  activeView: CalendarGridActiveViewContract;
  layout: CalendarGridLayout;
  showGridSkeleton?: boolean;
  showEventsLoadingState?: boolean;
  buildFallbackDayState: (items: CalendarGridItemLike[]) => CalendarGridDayState;
  closeEventEditor: () => void;
  setSelectedDay: (day: number) => void;
  setSelectedDateKey?: (dateKey: string) => void;
  setSelectedItemId: (itemId: string | null) => void;
  eventQuickActions?: CalendarCellQuickActions | null;
  deadlineQuickActions?: CalendarCellQuickActions | null;
  ghostPreview?: { ghosts?: CalendarGhostLike[]; kind?: string } | null;
  onOpenFloatingDetail?: (detail: Record<string, unknown>) => void;
  onCloseFloatingDetail?: () => boolean | void;
  floatingDetailOpen?: boolean;
  floatingDetailItemId?: unknown;
  floatingDetailMode?: string | null;
  floatingDetailDateKey?: string | null;
  floatingEditorDirty?: boolean;
  onCancelFloatingEditor?: () => void;
  onShakeFloatingEditor?: () => void;
  onDirectDateAction?: (dateKey: string) => void;
  onDirectItemAction?: (itemId: unknown, dateKey: string) => void;
  showWeekHeader?: boolean;
  isActiveMonth?: boolean;
  previewEvents?: CalendarSpanEvent[] | null;
  previewDeadlineOverlay?: CalendarDeadlineOverlay | null;
}

interface CalendarGridInteractionState {
  floatingEditorOpen: boolean;
  floatingDetailMode: string | null;
  floatingDetailDateKey: string | null;
  floatingEditorDirty: boolean;
  selectedItemId: unknown;
  resolvedOverflow: CalendarGridOverflowState | null;
  suppressedSelectedHiddenAutoOpenKey: string | null;
}

const emptyEvents: CalendarSpanEvent[] = [];

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
}: CalendarGridProps) {
  const gridShellRef = useRef<HTMLDivElement | null>(null);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  const [activeSpanSegmentId, setActiveSpanSegmentId] = useState<string | null>(null);
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
      openContextMenu: (payload: Record<string, unknown>) => {
        const item = payload.item as { itemKind?: string } | undefined;
        if (item?.itemKind === "deadline") return !!deadlineQuickActions?.openContextMenu?.(payload);
        return !!eventQuickActions?.openContextMenu?.(payload);
      },
      // Deadline drag slice, namespaced so it never collides with the event
      // drag fields the cell already reads off this merged object.
      deadlineDragEnabled: deadlineQuickActions?.dragEnabled,
      draggingDeadlineId: deadlineQuickActions?.draggingDeadlineId,
      deadlineDropTargetDate: deadlineQuickActions?.dropTargetDate,
      beginDeadlineDrag: deadlineQuickActions?.beginDrag,
      endDeadlineDrag: deadlineQuickActions?.endDrag,
      enterDeadlineDropTarget: deadlineQuickActions?.enterDropTarget,
      leaveDeadlineDropTarget: deadlineQuickActions?.leaveDropTarget,
      dropDeadline: deadlineQuickActions?.dropDeadline,
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
  const interactionStateRef = useRef<CalendarGridInteractionState | null>(null);
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

  const hasFullData = isActiveMonth || viewData != null;
  const resolvedEvents = useMemo(() => (
    hasFullData
      ? mergeAdjacentEventLists(viewData?.events, previewEvents) || emptyEvents
      : previewEvents || emptyEvents
  ), [hasFullData, previewEvents, viewData?.events]);
  const previewComputed = useMemo(() => {
    return buildCalendarMonthPreviewComputed({
      fullDataDeadlineOverlay: viewData?.deadlineOverlay,
      fullDataEvents: viewData?.events,
      hasFullData, activeView, previewDeadlineOverlay, previewEvents,
      viewMonth, viewYear,
    });
  }, [hasFullData, previewEvents, previewDeadlineOverlay, activeView, viewData?.deadlineOverlay, viewData?.events, viewYear, viewMonth]);

  const resolvedItemsByDate = previewComputed?.itemsByDate || itemsByDate;
  const resolvedItemsByDay = previewComputed?.itemsByDay || itemsByDay;

  const spanLayoutGhosts = useStableSpanLayoutGhosts(ghostPreview?.ghosts);
  const spanLayout = useMemo<CalendarEventSpanLayout>(() => {
    if (view !== "events") {
      return {
        spanSegments: [],
        pinnedByDate: {},
        reservedLaneCountByDate: {},
        pinnedGhostCountByDate: {},
        pinnedIds: new Set<string>(),
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
    day: number,
    isSelected: boolean,
    dateKey: string | null = null,
    { clearItemSelection = false, directDateAction = true } = {},
  ): void {
    const interaction = interactionStateRef.current;
    if (!interaction) return;
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
    day: number,
    itemId: unknown,
    dateKey: string | null = null,
    { keepOverflowOpen = false, anchorMeta = null }: {
      keepOverflowOpen?: boolean;
      anchorMeta?: CalendarGridFloatingAnchorMeta | null;
    } = {},
  ): void {
    const interaction = interactionStateRef.current;
    if (!interaction) return;
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
          if (!current || !sameOverflowDate(current, dateKey, day)) return current;
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

  function handleSelectSpanSegment(
    segment: CalendarSpanSegment,
    { triggerElement, dateKey }: { triggerElement: HTMLButtonElement; dateKey: string },
  ): void {
    if (!segment?.item || !segment.eventId) return;
    const requestedDateKey = dateKey || segment.segmentStart;
    const parsed = parseYmd(requestedDateKey);
    const nextDay = parsed?.day || selectedDay;
    if (nextDay == null) return;
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
          onBeforeItemAction={onCloseFloatingDetail}
          onClearActiveSpanSegment={(segmentId: string) => {
            setActiveSpanSegmentId((current) =>
              current === segmentId ? null : current,
            );
          }}
          onInlineOverflowInteraction={markOverflowInteraction}
          onSelectInlineOverflowItem={(itemId: unknown, anchorMeta: Record<string, unknown>) => {
            if (resolvedOverflow?.day == null) return;
            handleSelectItem(
              resolvedOverflow.day,
              itemId,
              resolvedOverflow.dateKey || null,
              { keepOverflowOpen: true, anchorMeta: anchorMeta as CalendarGridFloatingAnchorMeta },
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
        onSelectItem={(itemId: unknown, anchorMeta: CalendarGridFloatingAnchorMeta) => {
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
        quickActions={itemQuickActions}
        onBeforeItemAction={onCloseFloatingDetail}
        floatingDetailOpen={floatingDetailOpen}
      />
    </div>
  );
});

function useStableSpanLayoutGhosts(ghosts?: CalendarGhostLike[]) {
  const signature = calendarSpanLayoutGhostSignature(ghosts);
  return useMemo(() => calendarSpanLayoutGhostsFromSignature(signature), [signature]);
}
