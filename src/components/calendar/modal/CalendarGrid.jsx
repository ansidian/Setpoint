import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import CalendarSelectedCellFrame from "./CalendarSelectedCellFrame.jsx";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import CalendarMonthBoundaryOverlay from "./CalendarMonthBoundaryOverlay.jsx";
import { parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import {
  buildCalendarEventSpanLayout,
  isPinnedCalendarGhost,
} from "./calendarEventSpanLayout.js";
import { getEventSelectionId } from "../../../lib/redesign-helpers";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const GRID_ROWS = 6;
const CELL_HEADER_HEIGHT = 24;
const MONTH_WHEEL_THRESHOLD_PX = 180;
const MONTH_WHEEL_COOLDOWN_MS = 420;
const WHEEL_LINE_PX = 32;
const CURRENT_MONTH_BOUNDARY_COLOR = "#0095FF";
const OTHER_MONTH_BOUNDARY_COLOR = "rgba(137,180,250,0.32)";
const INLINE_OVERFLOW_PANEL_PADDING = 12;

function normalizeWheelDeltaY(event, fallbackPagePx) {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_PX;
  if (event.deltaMode === 2) return event.deltaY * fallbackPagePx;
  return event.deltaY;
}

function sameOverflowDate(overflow, dateKey, day) {
  if (!overflow) return false;
  if (overflow.dateKey && dateKey) return overflow.dateKey === dateKey;
  return overflow.day === day;
}

function getModalScrollContainer(element) {
  const panel = element?.closest?.("[data-testid='calendar-modal-panel']");
  const body = panel?.querySelector?.("[data-testid='calendar-modal-body']");
  return body?.parentElement || null;
}

function isCalendarRailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-modal-rail']");
}

function isCalendarGridCellTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[role='gridcell']");
}

function isCalendarFloatingDetailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

function isCalendarInlineOverflowTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-inline-overflow-layer='true']");
}

function canUseInlineOverflow({ triggerElement, hiddenStackHeight, layout }) {
  if (layout?.stacked || !triggerElement?.isConnected) return false;
  if (!Number.isFinite(hiddenStackHeight) || hiddenStackHeight <= 0) return false;

  const panel = triggerElement.closest("[data-testid='calendar-modal-panel']");
  const panelRect = panel?.getBoundingClientRect?.();
  const triggerRect = triggerElement.getBoundingClientRect();
  if (!panelRect) return false;

  return triggerRect.top + hiddenStackHeight <= panelRect.bottom - INLINE_OVERFLOW_PANEL_PADDING;
}

function resolveInlineOverflowAnchor(triggerElement, containerElement) {
  const triggerRect = triggerElement?.getBoundingClientRect?.();
  const containerRect = containerElement?.getBoundingClientRect?.();
  if (!triggerRect || !containerRect) return null;
  return {
    top: triggerRect.top - containerRect.top,
    left: triggerRect.left - containerRect.left - 4,
    width: triggerRect.width + 8,
  };
}

function inlineOverflowItemStyle({ item, selected, active }) {
  const accent = item.accent || "var(--ea-accent)";
  const quiet = item.complete || item.quiet;
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 1,
    height: 36,
    minWidth: 0,
    boxSizing: "border-box",
    padding: "4px 10px",
    borderRadius: 10,
    border: selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : quiet
          ? "1px solid rgba(255,255,255,0.035)"
          : "1px solid rgba(255,255,255,0.045)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 18%, transparent), color-mix(in srgb, ${accent} 8%, transparent))`
      : active
        ? "rgba(255,255,255,0.065)"
        : quiet
          ? "rgba(255,255,255,0.018)"
          : "rgba(255,255,255,0.03)",
    color: selected ? "#f6f7fb" : quiet ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.78)",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "background 140ms, border-color 140ms, color 140ms",
  };
}

function InlineOverflowMetadata({ item, selected }) {
  if (!item.leadingLabel && !item.recurring) return null;
  const color = selected
    ? item.leadingColor || item.accent || "var(--ea-accent)"
    : item.leadingColor || "rgba(205,214,244,0.62)";
  return (
    <span
      style={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 5,
        overflow: "hidden",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.15,
        lineHeight: 1.05,
        color,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {item.leadingLabel ? (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.leadingLabel}
        </span>
      ) : null}
      {item.recurring ? (
        <Repeat
          aria-hidden="true"
          size={10}
          strokeWidth={2.4}
          style={{ flexShrink: 0, color, opacity: selected ? 0.86 : 0.7 }}
        />
      ) : null}
    </span>
  );
}

function CalendarInlineOverflowLayer({
  overflow,
  selectedItemId,
  onSelectItem,
  onInteraction,
  quickActions,
  onBeforeItemAction,
}) {
  const [activeItemId, setActiveItemId] = useState(null);
  const layerRef = useRef(null);

  if (!overflow?.inlineAnchor || !overflow.items?.length) return null;
  const boundaryColor = overflow.boundaryColor || CURRENT_MONTH_BOUNDARY_COLOR;
  const drawBottomBoundary = overflow.boundarySides?.includes?.("bottom");

  return (
    <div
      ref={layerRef}
      data-testid="calendar-cell-inline-overflow"
      data-calendar-inline-overflow-layer="true"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        onInteraction?.();
        event.stopPropagation();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: overflow.inlineAnchor.top,
        left: overflow.inlineAnchor.left,
        width: overflow.inlineAnchor.width,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        padding: "4px",
        borderRadius: "0 0 10px 10px",
        border: "1px solid rgba(255,255,255,0.08)",
        borderTop: 0,
        background: "#16161e",
        boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        isolation: "isolate",
        animation: "calendarInlineOverflowIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {overflow.items.map((item) => {
        const itemId = String(item.id);
        const selected = itemId === String(selectedItemId);
        const active = itemId === String(activeItemId);
        const dragAllowed = !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent;
        return (
          <button
            key={item.id}
            type="button"
            data-testid="calendar-cell-item-chip"
            data-inline-overflow-item="true"
            data-item-id={itemId}
            data-hovered={active ? "true" : "false"}
            draggable={dragAllowed}
            data-calendar-focus-ring="true"
            onClick={(event) => {
              event.stopPropagation();
              onSelectItem?.(item.id, {
                triggerElement: event.currentTarget,
                sourceCellElement: overflow.sourceCellElement || null,
                exclusionElement: layerRef.current,
                dateKey: overflow.dateKey || null,
                anchorKind: "overflow-row",
                itemsSnapshot: item.sourceItem || item.sourceEvent ? [item.sourceItem || item.sourceEvent] : null,
              });
            }}
            onContextMenu={(event) => {
              if (!item.sourceEvent?.writable) return;
              event.preventDefault();
              event.stopPropagation();
              onBeforeItemAction?.();
              quickActions?.openDeleteMenu?.({
                event: item.sourceEvent,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onDragStart={(event) => {
              if (!dragAllowed || !quickActions?.beginDrag?.(item.sourceEvent)) {
                event.preventDefault();
                return;
              }
              onBeforeItemAction?.();
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
              event.dataTransfer.setData("text/plain", String(item.title || ""));
            }}
            onDragEnd={() => quickActions?.endDrag?.()}
            onPointerEnter={() => setActiveItemId(itemId)}
            onPointerLeave={() => setActiveItemId((current) => (current === itemId ? null : current))}
            onFocus={() => setActiveItemId(itemId)}
            onBlur={() => setActiveItemId((current) => (current === itemId ? null : current))}
            style={inlineOverflowItemStyle({ item, selected, active })}
          >
            <InlineOverflowMetadata item={item} selected={selected} />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11.75,
                fontWeight: selected ? 600 : 500,
                lineHeight: 1.1,
                textDecoration: item.complete ? "line-through" : "none",
                textDecorationColor: "rgba(205,214,244,0.28)",
              }}
            >
              {item.title}
            </span>
          </button>
        );
      })}
      {drawBottomBoundary ? (
        <span
          aria-hidden="true"
          data-calendar-inline-overflow-boundary="bottom"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: boundaryColor,
            borderBottomLeftRadius: 8,
            borderBottomRightRadius: 8,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
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
    return ghost.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate && !isPinnedCalendarGhost(ghost);
  });
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
  overflowOpen = false,
  overflowMode = null,
  onSelectDay,
  onSelectItem,
  onOpenOverflow,
  renderCellContents,
  quickActions,
}) {
  const [hovered, setHovered] = useState(false);
  const todayAccent = "var(--ea-accent)";
  const inlineOverflowOpen = overflowOpen && overflowMode === "inline";
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

  if (inlineOverflowOpen) {
    cellBg = "rgba(22,22,30,0.98)";
    cellBorder = "1px solid rgba(255,255,255,0.12)";
    cellShadow = "0 16px 36px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)";
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
    overflowOpen,
    overflowMode,
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
      data-overflow-open={overflowOpen ? "true" : "false"}
      data-overflow-mode={overflowMode || "none"}
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
          overflow: inlineOverflowOpen ? "visible" : "hidden",
        }}
      >
        <CalendarSelectedCellFrame
          view={view}
          selected={isSelected}
          isEmpty={!hasItems}
          pastTone={pastTone}
          isToday={isToday}
        >
          {renderedCellContents}
        </CalendarSelectedCellFrame>
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
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  onReanchorFloatingDetail,
  floatingDetailOpen = false,
  floatingDetailParked = false,
}) {
  const gridShellRef = useRef(null);
  const gridBodyRef = useRef(null);
  const monthWheelRef = useRef({ accumulatedY: 0, lastNavigateAt: -Infinity });
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
  const resolvedOverflow = overflowState
    && overflowState.view === view
    && overflowState.viewYear === viewYear
    && overflowState.viewMonth === viewMonth
      ? overflowState
      : null;
  const resolvedPopover = resolvedOverflow?.mode === "fallback" ? resolvedOverflow : null;
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

  const closeOverflow = useCallback(({ restoreFocus = false } = {}) => {
    const anchorKey = overflowState?.anchorKey;
    setOverflowState(null);
    if (!restoreFocus || !anchorKey) return;
    window.requestAnimationFrame(() => {
      const trigger = [...(gridShellRef.current?.querySelectorAll("[data-calendar-overflow-anchor-key]") || [])]
        .find((element) => element.getAttribute("data-calendar-overflow-anchor-key") === anchorKey);
      trigger?.focus?.();
    });
  }, [overflowState?.anchorKey, setOverflowState]);
  const closeOverflowWithoutFocus = useCallback(() => {
    setOverflowState(null);
  }, [setOverflowState]);
  const markOverflowInteraction = useCallback(() => {
    ignoreOverflowScrollUntilRef.current = performance.now() + 220;
  }, []);

  function handleSelectDay(day, isSelected, dateKey = null) {
    const isOverflowSourceDay = sameOverflowDate(resolvedOverflow, dateKey, day);
    if (!isOverflowSourceDay) setOverflowState(null);
    if (isSelected) return;

    closeEventEditor();
    onCloseFloatingDetail?.();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }

    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(null);
  }

  function handleSelectItem(day, itemId, dateKey = null, { keepOverflowOpen = false, anchorMeta = null } = {}) {
    closeEventEditor();
    if (view === "deadlines") {
      setDeadlineEditor(null);
    }
    setSelectedDay(day);
    if (dateKey) setSelectedDateKey?.(dateKey);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    if (keepOverflowOpen) {
      markOverflowInteraction();
    } else {
      setOverflowState(null);
    }
    if (!layout.stacked && anchorMeta?.triggerElement) {
      onOpenFloatingDetail?.({
        view,
        itemId: itemId != null ? String(itemId) : null,
        dateKey: anchorMeta.dateKey || dateKey || null,
        day,
        anchorElement: anchorMeta.triggerElement,
        sourceCellElement: anchorMeta.sourceCellElement || anchorMeta.triggerElement.closest?.("[role='gridcell']") || null,
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
      ? gridShellRef.current?.querySelector?.(`[role='gridcell'][data-date-key='${nextDateKey}']`) || null
      : null;
    handleSelectItem(nextDay, getEventSelectionId(segment.item), nextDateKey, {
      anchorMeta: {
        triggerElement,
        sourceCellElement,
        anchorKind: "span",
        itemsSnapshot: [segment.item],
      },
    });
  }

  useEffect(() => {
    if (!resolvedOverflow) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (floatingDetailOpen) return;
      closeOverflow({ restoreFocus: true });
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [closeOverflow, floatingDetailOpen, resolvedOverflow]);

  useEffect(() => {
    if (resolvedOverflow?.mode !== "inline") return undefined;
    function handlePointerDown(event) {
      if (resolvedOverflow.sourceCellElement?.contains(event.target)) return;
      if (resolvedOverflow.triggerElement?.contains(event.target)) return;
      if (isCalendarInlineOverflowTarget(event.target)) return;
      if (isCalendarFloatingDetailTarget(event.target)) return;
      if (isCalendarRailTarget(event.target)) return;
      if (gridShellRef.current?.contains(event.target) && isCalendarGridCellTarget(event.target)) return;
      setOverflowState(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [resolvedOverflow]);

  useEffect(() => {
    if (!floatingDetailParked || !selectedItemId || !selectedDateKey) return;
    const chips = [...(gridShellRef.current?.querySelectorAll("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-event-span-segment']") || [])];
    const anchor = chips.find((element) => element.getAttribute("data-item-id") === String(selectedItemId));
    if (!anchor) return;
    const sourceCellElement = anchor.closest("[role='gridcell']");
    if (sourceCellElement?.getAttribute("data-date-key") !== selectedDateKey) return;
    onReanchorFloatingDetail?.({
      view,
      itemId: String(selectedItemId),
      dateKey: selectedDateKey,
      day: Number(sourceCellElement?.getAttribute("data-date-key")?.slice(-2)) || selectedDay,
      anchorElement: anchor,
      sourceCellElement,
      exclusionElement: null,
      anchorKind: "chip",
    });
  }, [floatingDetailParked, onReanchorFloatingDetail, selectedDateKey, selectedDay, selectedItemId, view, viewMonth, viewYear]);

  useEffect(() => {
    const scrollContainer = getModalScrollContainer(gridShellRef.current);
    if (!resolvedOverflow || !scrollContainer) return undefined;
    function handleScroll() {
      if (performance.now() < ignoreOverflowScrollUntilRef.current) return;
      setOverflowState(null);
    }
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [resolvedOverflow]);

  useEffect(() => {
    if (!suppressOutsideClick || resolvedOverflow?.mode !== "inline") return undefined;
    suppressOutsideClick((target) => (
      resolvedOverflow.sourceCellElement?.contains(target)
      || resolvedOverflow.triggerElement?.contains(target)
      || isCalendarInlineOverflowTarget(target)
      || isCalendarRailTarget(target)
    ));
    return () => suppressOutsideClick(null);
  }, [resolvedOverflow, suppressOutsideClick]);

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

      <div ref={gridBodyRef} style={{ position: "relative", flex: 1, minHeight: 0 }}>
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
            const cellGhosts = getCellGhosts(ghostPreview, cell.dateKey);
            const resolvedDayState = dayState;
            const cellItems = activeView.getDayState
              ? resolvedDayState
              : rawItems;
            const reservedLaneCount = eventDateCells
              ? spanLayout.reservedLaneCountByDate?.[cell.dateKey] || 0
              : 0;
            const pinnedGhostCount = eventDateCells
              ? spanLayout.pinnedGhostCountByDate?.[cell.dateKey] || 0
              : 0;
            const selectionPool = Array.isArray(dayState.items)
              ? dayState.items
              : rawItems;
            const resolvedSelectionPool = selectionPool;
            const hasItems = resolvedDayState.totalCount > 0 || cellGhosts.length > 0 || reservedLaneCount > 0;
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
            const overflowOpen = sameOverflowDate(resolvedOverflow, cell.dateKey, day);
            const inlineOverflowOpen = overflowOpen && resolvedOverflow?.mode === "inline";

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
                itemCount={resolvedDayState.totalCount + cellGhosts.length + pinnedGhostCount}
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
                  const sourceCellElement = triggerElement?.closest?.("[role='gridcell']");
                  setOverflowState((current) => {
                    if (current?.anchorKey === anchorKey) {
                      return null;
                    }
                    const mode = canUseInlineOverflow({
                      triggerElement,
                      hiddenStackHeight,
                      layout,
                    }) ? "inline" : "fallback";
                    const inlineAnchor = mode === "inline"
                      ? resolveInlineOverflowAnchor(triggerElement, gridBodyRef.current)
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
                    onBeforeItemAction: onCloseFloatingDetail,
                    pinnedIds: eventDateCells ? spanLayout.pinnedIds : null,
                    reservedLaneCount,
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
          suppressedBoundary={resolvedOverflow?.mode === "inline" && resolvedOverflow.boundarySides?.includes?.("bottom")
            ? { dateKey: resolvedOverflow.dateKey, sides: ["bottom"] }
            : null}
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
            setActiveSpanSegmentId((current) => (current === segmentId ? null : current));
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
            quickActions={eventDateCells ? eventQuickActions : null}
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
        quickActions={eventDateCells ? eventQuickActions : null}
        onBeforeItemAction={onCloseFloatingDetail}
        floatingDetailOpen={floatingDetailOpen}
      />
    </div>
  );
}
