import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay";
import CalendarGridSkeleton from "./CalendarGridSkeleton";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer";
import type { CalendarSpanLayoutMetrics, CalendarSpanSegment } from "./calendarEventSpanLayout";
import type { CalendarGridOverflowState } from "./useCalendarGridOverflow";
import type { CalendarItemQuickActions } from "./CalendarCellItemChip";

export default function CalendarGridLayers({
  activeSpanSegmentId,
  daysInMonth,
  eventDateCells,
  eventQuickActions,
  firstDay,
  weekRows,
  itemQuickActions,
  layout,
  onBeforeItemAction,
  onClearActiveSpanSegment,
  onInlineOverflowInteraction,
  onSelectInlineOverflowItem,
  onSelectSpanSegment,
  onSetActiveSpanSegment,
  resolvedOverflow,
  resolvedTrailingEmpty,
  selectedItemId,
  showGridSkeleton,
  spanSegments,
}: {
  activeSpanSegmentId?: string | null;
  daysInMonth: number;
  eventDateCells: boolean;
  eventQuickActions?: CalendarItemQuickActions | null;
  firstDay: number;
  weekRows: number;
  itemQuickActions?: CalendarItemQuickActions | null;
  layout: CalendarSpanLayoutMetrics & { cellHeight: number; gridGap: number };
  onBeforeItemAction?: () => void;
  onClearActiveSpanSegment?: (segmentId: string) => void;
  onInlineOverflowInteraction?: () => void;
  onSelectInlineOverflowItem?: (itemId: unknown, meta: Record<string, unknown>) => void;
  onSelectSpanSegment?: (segment: CalendarSpanSegment, meta: { triggerElement: HTMLButtonElement; dateKey: string }) => void;
  onSetActiveSpanSegment?: (segmentId: string) => void;
  resolvedOverflow?: CalendarGridOverflowState | null;
  resolvedTrailingEmpty: number;
  selectedItemId?: unknown;
  showGridSkeleton: boolean;
  spanSegments: CalendarSpanSegment[];
}) {
  return (
    <>
      <CalendarEventSpanOverlay
        segments={spanSegments}
        layout={layout}
        weekRows={weekRows}
        selectedItemId={selectedItemId}
        activeSegmentId={activeSpanSegmentId}
        onSetActive={onSetActiveSpanSegment}
        onClearActive={onClearActiveSpanSegment}
        onSelectSegment={onSelectSpanSegment}
        quickActions={eventDateCells ? eventQuickActions : null}
        onBeforeAction={onBeforeItemAction}
      />
      {resolvedOverflow?.mode === "inline" ? (
        <CalendarInlineOverflowLayer
          overflow={resolvedOverflow}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectInlineOverflowItem}
          onInteraction={onInlineOverflowInteraction}
          quickActions={itemQuickActions}
          onBeforeItemAction={onBeforeItemAction}
        />
      ) : null}

      {showGridSkeleton && (
        <CalendarGridSkeleton
          firstDay={firstDay}
          daysInMonth={daysInMonth}
          trailingEmpty={resolvedTrailingEmpty}
          cellHeight={layout.cellHeight}
          gridGap={layout.gridGap}
          weekRows={weekRows}
        />
      )}
    </>
  );
}
