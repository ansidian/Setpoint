import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import CalendarSelectedCellFrame from "./CalendarSelectedCellFrame.jsx";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const GRID_ROWS = 6;
const CELL_HEADER_HEIGHT = 24;
const MONTH_WHEEL_THRESHOLD_PX = 180;
const MONTH_WHEEL_COOLDOWN_MS = 420;
const WHEEL_LINE_PX = 32;

function normalizeWheelDeltaY(event, fallbackPagePx) {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_PX;
  if (event.deltaMode === 2) return event.deltaY * fallbackPagePx;
  return event.deltaY;
}

function CalendarCell({
  view,
  day,
  items,
  selectedItemId,
  hasItems,
  isToday,
  isSelected,
  pastTone,
  hasOverdue,
  allComplete,
  loading,
  onSelectDay,
  onSelectItem,
  onOpenOverflow,
  renderCellContents,
}) {
  const todayAccent = "var(--ea-accent)";
  let cellBg = "rgba(255,255,255,0.015)";
  let cellBorder = "1px solid rgba(255,255,255,0.04)";
  let cellShadow = "none";
  let dateColor = "rgba(205,214,244,0.7)";
  let dateWeight = 400;
  let accentBar = null;
  let todayWash = null;
  let dateBadgeBg = "transparent";
  let dateBadgeBorder = "1px solid transparent";
  let dateBadgeShadow = "none";

  if (isSelected) {
    cellBg = "rgba(203,166,218,0.06)";
    cellBorder = "1px solid rgba(203,166,218,0.4)";
    cellShadow = "0 0 0 1px rgba(203,166,218,0.18), 0 4px 14px rgba(203,166,218,0.18)";
    dateColor = "#cba6da";
    dateWeight = 600;
  } else if (allComplete) {
    accentBar = "#a6e3a1";
    dateColor = "rgba(166,227,161,0.85)";
  } else if (hasOverdue) {
    accentBar = "#f38ba8";
    dateColor = "rgba(243,139,168,0.9)";
  } else if (hasItems) {
    dateColor = "#cdd6f4";
    dateWeight = 500;
  }

  if (!isSelected && !isToday && pastTone) {
    cellBg = pastTone === "items" ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.006)";
    cellBorder = pastTone === "items"
      ? "1px solid rgba(255,255,255,0.028)"
      : "1px solid rgba(255,255,255,0.022)";
    dateColor = pastTone === "items" ? "rgba(205,214,244,0.48)" : "rgba(205,214,244,0.33)";
    if (!hasItems) dateWeight = 400;
  }

  if (isToday) {
    todayWash = isSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 16%, transparent), color-mix(in srgb, ${todayAccent} 6%, transparent) 56%, transparent)`
      : `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 20%, transparent), color-mix(in srgb, ${todayAccent} 8%, transparent) 58%, transparent)`;
    dateColor = isSelected ? "#ffffff" : todayAccent;
    dateWeight = 700;
    dateBadgeBg = isSelected
      ? `color-mix(in srgb, ${todayAccent} 32%, transparent)`
      : `color-mix(in srgb, ${todayAccent} 18%, transparent)`;
    dateBadgeBorder = isSelected
      ? `1px solid color-mix(in srgb, ${todayAccent} 56%, white 12%)`
      : `1px solid color-mix(in srgb, ${todayAccent} 42%, transparent)`;
    dateBadgeShadow = isSelected
      ? `0 0 0 1px color-mix(in srgb, ${todayAccent} 18%, transparent), 0 6px 18px color-mix(in srgb, ${todayAccent} 24%, transparent)`
      : `0 4px 12px color-mix(in srgb, ${todayAccent} 18%, transparent)`;
  }

  const renderedCellContents = renderCellContents?.({
    items,
    hasOverdue,
    isToday,
    loading,
    pastTone,
    isSelected,
    day,
    selectedItemId,
    overflowOpen: false,
    onSelectDay: () => onSelectDay?.(),
    onSelectItem,
    onOpenOverflow,
  });

  return (
    <div
      onClick={() => onSelectDay?.()}
      aria-current={isToday ? "date" : undefined}
      data-testid={`calendar-cell-${day}`}
      data-past-tone={pastTone || "none"}
      style={{
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: 8,
        padding: "6px 8px",
        background: cellBg,
        border: cellBorder,
        boxShadow: cellShadow,
        cursor: "pointer",
        transition: "box-shadow 150ms, border-color 150ms, background 150ms",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {todayWash && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: 7,
            background: todayWash,
            pointerEvents: "none",
          }}
        />
      )}
      {accentBar && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            background: accentBar,
            borderRadius: 2,
            opacity: 0.55,
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: CELL_HEADER_HEIGHT,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: isToday ? 24 : undefined,
            height: isToday ? 24 : undefined,
            padding: isToday ? "0 8px" : 0,
            borderRadius: 999,
            fontSize: 12.5,
            lineHeight: 1,
            color: dateColor,
            fontWeight: dateWeight,
            fontVariantNumeric: "tabular-nums",
            background: dateBadgeBg,
            border: dateBadgeBorder,
            boxShadow: dateBadgeShadow,
            transition: "background 150ms, border-color 150ms, box-shadow 150ms",
          }}
        >
          {day}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {isSelected ? (
          <CalendarSelectedCellFrame
            view={view}
            isEmpty={!hasItems}
            pastTone={pastTone}
            isToday={isToday}
          >
            {renderedCellContents}
          </CalendarSelectedCellFrame>
        ) : (
          renderedCellContents
        )}
      </div>
    </div>
  );
}

function CalendarGridSkeleton({
  firstDay,
  daysInMonth,
  trailingEmpty,
  cellHeight,
  gridGap,
  fillHeight,
  rowCount,
}) {
  const rowWidths = cellHeight >= 96 ? ["84%", "71%", "58%"] : ["86%", "63%"];

  return (
    <div
      data-testid="calendar-grid-skeleton"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: fillHeight
          ? `repeat(${rowCount}, minmax(0, 1fr))`
          : `repeat(${GRID_ROWS}, ${cellHeight}px)`,
        gap: gridGap,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: firstDay }, (_, index) => <div key={`sk-empty-${index}`} />)}
      {Array.from({ length: daysInMonth }, (_, index) => (
        <div
          key={`sk-day-${index}`}
          style={{
            padding: "28px 9px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {rowWidths.map((width, rowIndex) => (
              <Skeleton
                key={rowIndex}
                className="h-[10px] rounded-sm bg-white/8"
                style={{ width, opacity: rowIndex === rowWidths.length - 1 ? 0.72 : 1 }}
              />
            ))}
          </div>
        </div>
      ))}
      {Array.from({ length: trailingEmpty }, (_, index) => <div key={`sk-trail-${index}`} />)}
    </div>
  );
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
  selectedDay,
  selectedItemId,
  viewData,
  activeView,
  layout,
  suppressOutsideClick,
  showGridSkeleton,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedItemId,
  setDeadlineEditor,
  canGoPrev = true,
  navigateMonth,
}) {
  const gridShellRef = useRef(null);
  const monthWheelRef = useRef({ accumulatedY: 0, lastNavigateAt: -Infinity });
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const fillGridHeight = !layout.stacked;
  const gridRowCount = fillGridHeight
    ? Math.max(1, Math.ceil((firstDay + daysInMonth) / 7))
    : GRID_ROWS;
  const resolvedTrailingEmpty = fillGridHeight
    ? Math.max(0, gridRowCount * 7 - firstDay - daysInMonth)
    : trailingEmpty;
  const [overflowPopover, setOverflowPopover] = useState(null);
  const resolvedPopover = overflowPopover
    && overflowPopover.view === view
    && overflowPopover.viewYear === viewYear
    && overflowPopover.viewMonth === viewMonth
      ? overflowPopover
      : null;

  function handleSelectDay(day, isSelected) {
    if (isSelected) return;

    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }

    setSelectedDay(day);
    setSelectedItemId(null);
  }

  function handleSelectItem(day, itemId) {
    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }
    setSelectedDay(day);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setOverflowPopover(null);
  }

  useEffect(() => {
    const element = gridShellRef.current;
    if (!element || layout.stacked || !navigateMonth) return undefined;

    function handleMonthWheel(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;

      const absX = Math.abs(event.deltaX || 0);
      const absY = Math.abs(event.deltaY || 0);
      if (absY === 0 || absX > absY) return;

      const normalizedY = normalizeWheelDeltaY(event, element.clientHeight || window.innerHeight || 800);
      const direction = normalizedY > 0 ? 1 : -1;
      if (direction < 0 && !canGoPrev) {
        monthWheelRef.current.accumulatedY = 0;
        return;
      }

      if (event.cancelable) event.preventDefault();

      const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      if (now - monthWheelRef.current.lastNavigateAt < MONTH_WHEEL_COOLDOWN_MS) return;

      monthWheelRef.current.accumulatedY += normalizedY;
      if (Math.abs(monthWheelRef.current.accumulatedY) < MONTH_WHEEL_THRESHOLD_PX) return;

      const monthDirection = monthWheelRef.current.accumulatedY > 0 ? 1 : -1;
      if (monthDirection > 0 || canGoPrev) {
        navigateMonth(monthDirection);
        monthWheelRef.current.lastNavigateAt = now;
      }
      monthWheelRef.current.accumulatedY = 0;
    }

    element.addEventListener("wheel", handleMonthWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleMonthWheel);
  }, [canGoPrev, layout.stacked, navigateMonth]);

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: layout.weekHeaderGap, marginBottom: 8, flexShrink: 0 }}>
        {DAYS.map((day) => (
          <div
            key={day}
            style={{
              textAlign: "center",
              fontSize: 10,
              fontWeight: 600,
              color: "rgba(205,214,244,0.4)",
              padding: 4,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            {day}
          </div>
        ))}
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div
          data-testid="calendar-grid-month"
          key={`${view}-${viewYear}-${viewMonth}`}
          style={{
            height: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gridTemplateRows: fillGridHeight
              ? `repeat(${gridRowCount}, minmax(0, 1fr))`
              : `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
            gap: layout.gridGap,
          }}
        >
          {Array.from({ length: firstDay }, (_, index) => <div key={`empty-${index}`} />)}

          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const rawItems = Array.isArray(itemsByDay[day]) ? itemsByDay[day] : [];
            const dayState = activeView.getDayState?.(itemsByDay[day]) ?? buildFallbackDayState(itemsByDay[day]);
            const cellItems = activeView.getDayState ? dayState : rawItems;
            const selectionPool = Array.isArray(dayState.items) ? dayState.items : rawItems;
            const hasItems = dayState.totalCount > 0;
            const isToday = isCurrentMonth && day === todayDate;
            const isSelected = selectedDay === day;
            const hasOverdue = activeView.hasOverdue?.(dayState) || false;
            const allComplete = activeView.allComplete?.(dayState) || false;
            const isPastDay = view === "events"
              && new Date(viewYear, viewMonth, day) < new Date(currentYear, currentMonth, todayDate);
            const pastTone = isPastDay ? (hasItems ? "items" : "empty") : null;
            const resolveItemId = activeView.getItemId || ((item) => item?.id);
            const dayHasSelectedItem = isSelected && selectionPool.some((item) => String(resolveItemId(item)) === String(selectedItemId));
            const overflowOpen = resolvedPopover?.day === day;

            return (
              <CalendarCell
                key={day}
                view={view}
                day={day}
                items={cellItems}
                selectedItemId={dayHasSelectedItem ? selectedItemId : null}
                hasItems={hasItems}
                isToday={isToday}
                isSelected={isSelected}
                pastTone={pastTone}
                hasOverdue={hasOverdue}
                allComplete={allComplete}
                loading={viewData?.isLoading}
                onSelectDay={() => handleSelectDay(day, isSelected)}
                onSelectItem={(itemId) => handleSelectItem(day, itemId)}
                onOpenOverflow={({ triggerElement, hiddenItems, totalCount, visibleCount }) => {
                  const anchorKey = `${view}-${viewYear}-${viewMonth}-${day}`;
                  setOverflowPopover((current) => {
                    if (current?.anchorKey === anchorKey) {
                      return null;
                    }
                    return {
                      triggerElement,
                      items: hiddenItems,
                      totalCount,
                      visibleCount,
                      label: new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      }),
                      viewLabel: activeView.label || (view[0].toUpperCase() + view.slice(1)),
                      day,
                      view,
                      viewYear,
                      viewMonth,
                      anchorKey,
                    };
                  });
                }}
                renderCellContents={(args) => activeView.renderCellContents?.({
                  ...args,
                  overflowOpen,
                  layout,
                })}
              />
            );
          })}

          {Array.from({ length: resolvedTrailingEmpty }, (_, index) => <div key={`trail-${index}`} />)}
        </div>

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
        onSelectItem={(itemId) => {
          if (resolvedPopover?.day == null) return;
          handleSelectItem(resolvedPopover.day, itemId);
        }}
        onClose={() => setOverflowPopover(null)}
        suppressOutsideClick={suppressOutsideClick}
      />
    </div>
  );
}
