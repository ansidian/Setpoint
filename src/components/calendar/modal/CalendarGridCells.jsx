import CalendarCell from "./CalendarCell.jsx";
import { buildCalendarGridCellModel } from "./calendarGridCellModel.js";
import { sameOverflowDate } from "./calendarGridUtils.js";

export default function CalendarGridCells({
  activeView,
  buildFallbackDayState,
  cellMetaByDate,
  currentMonth,
  currentYear,
  eventDateCells,
  ghostPreview,
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
  todayDate,
  view,
  viewData,
  viewMonth,
  viewYear,
}) {
  return monthCells.map((cell) => {
    const day = cell.day;
    const cellMeta = cellMetaByDate?.[cell.dateKey] || null;
    const {
      allComplete,
      cellGhosts,
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
      currentMonth,
      currentYear,
      eventDateCells,
      ghostPreview,
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
        itemCount={itemCount}
        hasItems={hasItems}
        isToday={isToday}
        isSelected={isSelected}
        pastTone={pastTone}
        hasOverdue={hasOverdue}
        allComplete={allComplete}
        loading={loading}
        overflowOpen={overflowOpen}
        overflowMode={overflowOpen ? resolvedOverflow?.mode : null}
        onSelectDay={() =>
          onSelectDay(day, isSelected, cell.dateKey)
        }
        onSelectDateHeader={() =>
          onSelectDay(day, isSelected, cell.dateKey, {
            clearItemSelection: true,
            directDateAction: false,
          })
        }
        onSelectItem={(itemId, anchorMeta) =>
          onSelectItem(day, itemId, cell.dateKey, {
            keepOverflowOpen: overflowOpen,
            anchorMeta,
          })
        }
        onOpenOverflow={(composition) =>
          onOpenOverflow({
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
            inlineOverflowVisibleCount: inlineOverflowOpen
              ? resolvedOverflow?.visibleCount
              : null,
            inlineOverflowExternal: true,
            onInlineOverflowInteraction,
            onCloseInlineOverflow,
            onHiddenItemsChange,
            onBeforeItemAction,
            pinnedIds: eventDateCells ? spanLayout.pinnedIds : null,
            reservedLaneCount,
            layout,
          })
        }
        quickActions={itemQuickActions}
      />
    );
  });
}
