import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import CalendarSelectedCellFrame from "./CalendarSelectedCellFrame.jsx";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import CalendarGhostOverlay from "./CalendarGhostOverlay.jsx";
import { parseYmd, ymdFromParts } from "../calendarDateUtils.js";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const GRID_ROWS = 6;
const CELL_HEADER_HEIGHT = 24;
const MONTH_WHEEL_THRESHOLD_PX = 180;
const MONTH_WHEEL_COOLDOWN_MS = 420;
const WHEEL_LINE_PX = 32;
const CURRENT_MONTH_BOUNDARY_COLOR = "#0095FF";
const OTHER_MONTH_BOUNDARY_COLOR = "rgba(137,180,250,0.32)";

function normalizeWheelDeltaY(event, fallbackPagePx) {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_PX;
  if (event.deltaMode === 2) return event.deltaY * fallbackPagePx;
  return event.deltaY;
}

function formatCellDate(viewYear, viewMonth, day) {
  return new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatCellDateKey(dateKey) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return "";
  return new Date(parsed.year, parsed.month, parsed.day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function buildCellAriaLabel({
  viewLabel,
  viewYear,
  viewMonth,
  day,
  dateKey,
  itemCount,
  isSelected,
  isToday,
}) {
  const noun = {
    events: "event",
    bills: "bill",
    deadlines: "deadline",
  }[String(viewLabel || "item").toLowerCase()] || "item";
  const countLabel = itemCount === 0
    ? `No ${noun}s`
    : `${itemCount} ${noun}${itemCount === 1 ? "" : "s"}`;
  return [
    dateKey ? formatCellDateKey(dateKey) : formatCellDate(viewYear, viewMonth, day),
    countLabel,
    isToday ? "today" : null,
    isSelected ? "selected" : null,
  ].filter(Boolean).join(", ");
}

function getCellGhosts(ghostPreview, dateKey) {
  if (!dateKey || !ghostPreview?.ghosts?.length) return [];
  return ghostPreview.ghosts.filter((ghost) => {
    if (ghost.kind === "deadline") return ghost.startDate === dateKey;
    return ghost.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate;
  });
}

function cellBoundaryMeta(cell, index) {
  return {
    ...cell,
    index,
    row: Math.floor(index / 7) + 1,
    column: (index % 7) + 1,
  };
}

function pushHorizontalBoundarySegments({ segments, cells, side }) {
  const byRow = new Map();
  cells.forEach((cell) => {
    if (!cell.boundarySides.includes(side)) return;
    const key = `${cell.row}:${cell.boundaryColor}`;
    const rowCells = byRow.get(key) || [];
    rowCells.push(cell);
    byRow.set(key, rowCells);
  });

  byRow.forEach((rowCells) => {
    const ordered = rowCells.sort((a, b) => a.column - b.column);
    let run = [];
    function flushRun() {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      segments.push({
        id: `${side}-${first.dateKey}-${last.dateKey}`,
        side,
        color: first.boundaryColor,
        row: first.row,
        columnStart: first.column,
        columnEnd: last.column + 1,
        startCap: first.boundarySides.includes("left"),
        endCap: last.boundarySides.includes("right"),
      });
      run = [];
    }

    ordered.forEach((cell) => {
      const prev = run[run.length - 1];
      if (!prev || cell.column === prev.column + 1) {
        run.push(cell);
        return;
      }
      flushRun();
      run.push(cell);
    });
    flushRun();
  });
}

function pushVerticalBoundarySegments({ segments, cells, side }) {
  const byColumn = new Map();
  cells.forEach((cell) => {
    if (!cell.boundarySides.includes(side)) return;
    const key = `${cell.column}:${cell.boundaryColor}`;
    const columnCells = byColumn.get(key) || [];
    columnCells.push(cell);
    byColumn.set(key, columnCells);
  });

  byColumn.forEach((columnCells) => {
    const ordered = columnCells.sort((a, b) => a.row - b.row);
    let run = [];
    function flushRun() {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      segments.push({
        id: `${side}-${first.dateKey}-${last.dateKey}`,
        side,
        color: first.boundaryColor,
        column: first.column,
        rowStart: first.row,
        rowEnd: last.row + 1,
        startCap: first.boundarySides.includes("top"),
        endCap: last.boundarySides.includes("bottom"),
      });
      run = [];
    }

    ordered.forEach((cell) => {
      const prev = run[run.length - 1];
      if (!prev || cell.row === prev.row + 1) {
        run.push(cell);
        return;
      }
      flushRun();
      run.push(cell);
    });
    flushRun();
  });
}

function buildBoundarySegments(monthCells) {
  const cells = monthCells.map(cellBoundaryMeta).filter((cell) => cell.boundarySides.length);
  const segments = [];
  pushHorizontalBoundarySegments({ segments, cells, side: "top" });
  pushHorizontalBoundarySegments({ segments, cells, side: "bottom" });
  pushVerticalBoundarySegments({ segments, cells, side: "left" });
  pushVerticalBoundarySegments({ segments, cells, side: "right" });
  return segments;
}

function CalendarMonthBoundaryOverlay({
  monthCells,
  layout,
  gridRowCount,
  fillGridHeight,
}) {
  const boundaryStrokeWidth = 2;
  const segments = buildBoundarySegments(monthCells);
  if (!segments.length) return null;

  return (
    <div
      data-testid="calendar-month-boundary-overlay"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gridTemplateRows: fillGridHeight
          ? `repeat(${gridRowCount}, minmax(0, 1fr))`
          : `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
        gap: layout.gridGap,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {segments.map((segment) => {
        if (segment.side === "top" || segment.side === "bottom") {
          return (
            <span
              key={segment.id}
              data-testid={`calendar-month-boundary-${segment.id}`}
              data-boundary-side={segment.side}
              style={{
                gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                gridRow: segment.row,
                alignSelf: segment.side === "top" ? "start" : "end",
                height: boundaryStrokeWidth,
                background: segment.color,
                borderTopLeftRadius: segment.side === "top" && segment.startCap ? 8 : 0,
                borderTopRightRadius: segment.side === "top" && segment.endCap ? 8 : 0,
                borderBottomLeftRadius: segment.side === "bottom" && segment.startCap ? 8 : 0,
                borderBottomRightRadius: segment.side === "bottom" && segment.endCap ? 8 : 0,
              }}
            />
          );
        }

        return (
          <span
            key={segment.id}
            data-testid={`calendar-month-boundary-${segment.id}`}
            data-boundary-side={segment.side}
            style={{
              gridColumn: segment.column,
              gridRow: `${segment.rowStart} / ${segment.rowEnd}`,
              justifySelf: segment.side === "left" ? "start" : "end",
              width: boundaryStrokeWidth,
              background: segment.color,
              borderTopLeftRadius: segment.side === "left" && segment.startCap ? 8 : 0,
              borderTopRightRadius: segment.side === "right" && segment.startCap ? 8 : 0,
              borderBottomLeftRadius: segment.side === "left" && segment.endCap ? 8 : 0,
              borderBottomRightRadius: segment.side === "right" && segment.endCap ? 8 : 0,
            }}
          />
        );
      })}
    </div>
  );
}

function CalendarCell({
  view,
  viewYear,
  viewMonth,
  viewLabel,
  day,
  dateKey,
  dateLabel,
  inCurrentMonth = true,
  boundarySides = [],
  items,
  ghosts,
  selectedItemId,
  itemCount,
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
  quickActions,
}) {
  const [hovered, setHovered] = useState(false);
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

  if (!inCurrentMonth) {
    cellBg = "rgba(255,255,255,0.008)";
    cellBorder = "1px solid rgba(255,255,255,0.022)";
    dateColor = "rgba(205,214,244,0.34)";
  }

  if (isSelected) {
    cellBg = "rgba(203,166,218,0.06)";
    cellBorder = "1px solid rgba(203,166,218,0.4)";
    cellShadow =
      "0 0 0 1px rgba(203,166,218,0.18), 0 4px 14px rgba(203,166,218,0.18)";
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
    cellBg =
      pastTone === "items"
        ? "rgba(255,255,255,0.01)"
        : "rgba(255,255,255,0.006)";
    cellBorder =
      pastTone === "items"
        ? "1px solid rgba(255,255,255,0.028)"
        : "1px solid rgba(255,255,255,0.022)";
    dateColor =
      pastTone === "items"
        ? "rgba(205,214,244,0.48)"
        : "rgba(205,214,244,0.33)";
    if (!hasItems) dateWeight = 400;
  }

  if (!isSelected && hovered) {
    cellBg = inCurrentMonth
      ? "rgba(255,255,255,0.035)"
      : "rgba(255,255,255,0.018)";
    cellBorder = "1px solid rgba(255,255,255,0.085)";
  }

  const isDropTarget = quickActions?.dropTargetDate === dateKey;
  if (isDropTarget) {
    cellBg = "rgba(203,166,218,0.10)";
    cellBorder = "1px solid rgba(203,166,218,0.58)";
    cellShadow =
      "0 0 0 1px rgba(203,166,218,0.20), inset 0 0 0 1px rgba(203,166,218,0.08)";
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
    ghosts,
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
    quickActions,
    dateKey,
  });
  const ariaLabel = buildCellAriaLabel({
    viewLabel,
    viewYear,
    viewMonth,
    day,
    dateKey,
    itemCount,
    isSelected,
    isToday,
  });

  return (
    <div
      onClick={() => onSelectDay?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelectDay?.();
      }}
      role="gridcell"
      aria-roledescription="calendar day"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-current={isToday ? "date" : undefined}
      aria-selected={isSelected}
      data-calendar-focus-ring="true"
      data-testid={
        inCurrentMonth ? `calendar-cell-${day}` : `calendar-cell-${dateKey}`
      }
      data-date-key={dateKey || undefined}
      data-current-month={inCurrentMonth ? "true" : "false"}
      data-boundary-side={
        boundarySides.length ? boundarySides.join(" ") : "none"
      }
      data-past-tone={pastTone || "none"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        quickActions?.leaveDropTarget?.(dateKey);
      }}
      onDragEnter={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
        quickActions.enterDropTarget(dateKey);
      }}
      onDragOver={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
        const payload = event.dataTransfer?.getData(
          "application/x-ea-calendar-event",
        );
        let droppedEvent = null;
        try {
          droppedEvent = payload ? JSON.parse(payload) : null;
        } catch {
          droppedEvent = null;
        }
        quickActions.dropEvent({
          event: droppedEvent,
          targetDate: dateKey,
          anchorRect: event.currentTarget.getBoundingClientRect(),
        });
      }}
      style={{
        position: "relative",
        minWidth: 0,
        overflow: "visible",
        borderRadius: 8,
        padding: "6px 8px",
        background: cellBg,
        border: cellBorder,
        boxShadow: cellShadow,
        cursor: "pointer",
        opacity: inCurrentMonth ? 1 : 0.68,
        transition:
          "box-shadow 150ms, border-color 150ms, background 150ms, opacity 150ms",
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
          aria-hidden
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
            transition:
              "background 150ms, border-color 150ms, box-shadow 150ms",
          }}
        >
          {dateLabel || day}
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
  itemsByDate,
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
  ghostPreview,
  canGoPrev = true,
  navigateMonth,
  monthMotionDirection = 0,
}) {
  const gridShellRef = useRef(null);
  const monthWheelRef = useRef({ accumulatedY: 0, lastNavigateAt: -Infinity });
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
  const eventDateCells = view === "events";
  const selectedCellKey = selectedDateKey;
  const viewedMonthIsActualCurrentMonth =
    viewYear === currentYear && viewMonth === currentMonth;

  const eventCellCount = (fillGridHeight ? gridRowCount : GRID_ROWS) * 7;
  const monthCells = Array.from({ length: eventCellCount }, (_, index) => {
        const date = new Date(Date.UTC(viewYear, viewMonth, 1, 12));
        date.setUTCDate(date.getUTCDate() - firstDay + index);
        const dateKey = date.toISOString().slice(0, 10);
        const parsed = parseYmd(dateKey);
        const inCurrentMonth =
          parsed?.year === viewYear && parsed?.month === viewMonth;
        const monthLabel = new Date(
          parsed.year,
          parsed.month,
          parsed.day,
        ).toLocaleDateString("en-US", { month: "short" });
        return {
          day: parsed.day,
          dateKey,
          dateLabel: String(parsed.day),
          inCurrentMonth,
          inActualCurrentMonth:
            parsed?.year === currentYear && parsed?.month === currentMonth,
          boundarySides: [],
          monthLabel,
          adjacentPosition: inCurrentMonth
            ? "current"
            : dateKey < ymdFromParts(viewYear, viewMonth, 1)
              ? "leading"
              : "trailing",
        };
      }).map((cell, index, cells) => {
        if (cell.inCurrentMonth) return cell;
        const sides = [];
        const left = index % 7 === 0 ? null : cells[index - 1];
        const right = index % 7 === 6 ? null : cells[index + 1];
        const top = index < 7 ? null : cells[index - 7];
        const bottom = index >= cells.length - 7 ? null : cells[index + 7];
        if (left?.inCurrentMonth) sides.push("left");
        if (right?.inCurrentMonth) sides.push("right");
        if (top?.inCurrentMonth) sides.push("top");
        if (bottom?.inCurrentMonth) sides.push("bottom");
        return {
          ...cell,
          dateLabel: cell.adjacentPosition === "trailing" && cell.day === 1
            ? `${cell.monthLabel} ${cell.day}`
            : cell.dateLabel,
          boundarySides: sides,
          boundaryColor:
            viewedMonthIsActualCurrentMonth || cell.inActualCurrentMonth
              ? CURRENT_MONTH_BOUNDARY_COLOR
              : OTHER_MONTH_BOUNDARY_COLOR,
        };
      });

  function handleSelectDay(day, isSelected, dateKey = null) {
    if (isSelected) return;

    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }

    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(null);
  }

  function handleSelectItem(day, itemId, dateKey = null) {
    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }
    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: layout.weekHeaderGap,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        {DAYS.map((day) => (
          <div
            key={day}
            role="columnheader"
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
            const cellGhosts = getCellGhosts(ghostPreview, cell.dateKey);
            const resolvedDayState = dayState;
            const cellItems = activeView.getDayState
              ? resolvedDayState
              : rawItems;
            const selectionPool = Array.isArray(dayState.items)
              ? dayState.items
              : rawItems;
            const resolvedSelectionPool = selectionPool;
            const hasItems = resolvedDayState.totalCount > 0 || cellGhosts.length > 0;
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
            const overflowOpen = resolvedPopover?.dateKey
              ? resolvedPopover.dateKey === cell.dateKey
              : resolvedPopover?.day === day;

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
                selectedItemId={dayHasSelectedItem ? selectedItemId : null}
                itemCount={resolvedDayState.totalCount + cellGhosts.length}
                hasItems={hasItems}
                isToday={isToday}
                isSelected={isSelected}
                pastTone={pastTone}
                hasOverdue={hasOverdue}
                allComplete={allComplete}
                loading={viewData?.isLoading}
                onSelectDay={() =>
                  handleSelectDay(day, isSelected, cell.dateKey)
                }
                onSelectItem={(itemId) =>
                  handleSelectItem(day, itemId, cell.dateKey)
                }
                onOpenOverflow={({
                  triggerElement,
                  hiddenItems,
                  totalCount,
                  visibleCount,
                }) => {
                  const anchorKey = `${view}-${cell.dateKey || `${viewYear}-${viewMonth}-${day}`}`;
                  setOverflowPopover((current) => {
                    if (current?.anchorKey === anchorKey) {
                      return null;
                    }
                    return {
                      triggerElement,
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
                    };
                  });
                }}
                renderCellContents={(args) =>
                  activeView.renderCellContents?.({
                    ...args,
                    overflowOpen,
                    layout,
                  })
                }
                quickActions={eventDateCells ? eventQuickActions : null}
              />
            );
          })}

        </div>
        <CalendarMonthBoundaryOverlay
          monthCells={monthCells}
          layout={layout}
          gridRowCount={gridRowCount}
          fillGridHeight={fillGridHeight}
        />
        <CalendarGhostOverlay
          ghostPreview={ghostPreview}
          monthCells={monthCells}
          layout={layout}
          gridRowCount={gridRowCount}
          fillGridHeight={fillGridHeight}
        />

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
          handleSelectItem(
            resolvedPopover.day,
            itemId,
            resolvedPopover.dateKey || null,
          );
        }}
        onClose={() => setOverflowPopover(null)}
        suppressOutsideClick={suppressOutsideClick}
        quickActions={eventDateCells ? eventQuickActions : null}
      />
    </div>
  );
}
