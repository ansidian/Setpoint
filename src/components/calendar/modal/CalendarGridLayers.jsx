import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import CalendarGridSkeleton from "./CalendarGridSkeleton.jsx";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer.jsx";
import CalendarMonthBoundaryOverlay from "./CalendarMonthBoundaryOverlay.jsx";

export default function CalendarGridLayers({
  activeSpanSegmentId,
  daysInMonth,
  eventDateCells,
  eventQuickActions,
  fillGridHeight,
  firstDay,
  gridRowCount,
  itemQuickActions,
  layout,
  monthCells,
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
        segments={spanSegments}
        layout={layout}
        gridRowCount={gridRowCount}
        fillGridHeight={fillGridHeight}
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
          fillHeight={fillGridHeight}
          rowCount={gridRowCount}
        />
      )}
    </>
  );
}
