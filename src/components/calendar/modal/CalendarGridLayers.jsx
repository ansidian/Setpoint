import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import CalendarGridSkeleton from "./CalendarGridSkeleton.jsx";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer.jsx";

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
