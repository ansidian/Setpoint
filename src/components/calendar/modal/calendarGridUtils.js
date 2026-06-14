import { parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { isPinnedCalendarGhost } from "./calendarEventSpanLayout.js";

export const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const CELL_HEADER_HEIGHT = 24;
export const CURRENT_MONTH_BOUNDARY_COLOR = "#0095FF";
export const OTHER_MONTH_BOUNDARY_COLOR = "rgba(137,180,250,0.32)";
const INLINE_OVERFLOW_LAYER_PADDING = 4;
const INLINE_OVERFLOW_LAYER_BORDER_WIDTH = 1;
const INLINE_OVERFLOW_LAYER_ITEM_HEIGHT = 36;
const INLINE_OVERFLOW_LAYER_GAP = 4;


export function sameOverflowDate(overflow, dateKey, day) {
  if (!overflow) return false;
  if (overflow.dateKey && dateKey) return overflow.dateKey === dateKey;
  return overflow.day === day;
}

export function overflowStateIsLiveInScope(overflow, { view, viewYear, viewMonth } = {}) {
  if (!overflow) return false;
  if (overflow.view !== view || overflow.viewYear !== viewYear || overflow.viewMonth !== viewMonth) {
    return false;
  }
  if (!overflow.sourceCellElement?.isConnected) {
    return false;
  }
  if (overflow.mode === "inline") return !!overflow.inlineAnchor;
  if (!overflow.triggerElement?.isConnected) return false;
  return true;
}

export function spanCoversOverflowDate(overflow, segment) {
  if (!overflow || !segment) return false;
  if (overflow.dateKey && segment.segmentStart && segment.segmentEnd) {
    return segment.segmentStart <= overflow.dateKey && overflow.dateKey <= segment.segmentEnd;
  }
  return false;
}

export function overflowHiddenSignature(items) {
  return (items || []).map((item) => String(item.id)).join("\u001f");
}

export function getModalScrollContainer(element) {
  const panel = element?.closest?.("[data-testid='calendar-modal-panel']");
  const body = panel?.querySelector?.("[data-testid='calendar-modal-body']");
  return body?.parentElement || null;
}

export function isCalendarRailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-modal-rail']");
}

export function isCalendarGridCellTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[role='gridcell']");
}

export function isCalendarFloatingDetailTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

export function isCalendarInlineOverflowTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-inline-overflow-layer='true']");
}

export function isCalendarOverflowTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-overflow-trigger='true']");
}

export function isCalendarEventSpanTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest(
      "[data-testid='calendar-event-span-segment'], [data-testid='calendar-event-span-overlay']",
    );
}

export function canUseInlineOverflow({ triggerElement, layout }) {
  if (layout?.stacked || !triggerElement?.isConnected) return false;
  return true;
}

export function resolveInlineOverflowAnchor(triggerElement, containerElement) {
  const triggerRect = triggerElement?.getBoundingClientRect?.();
  const containerRect = containerElement?.getBoundingClientRect?.();
  if (!triggerRect || !containerRect) return null;
  return {
    top: triggerRect.top - containerRect.top,
    left: triggerRect.left - containerRect.left - 4,
    width: triggerRect.width + 8,
  };
}

function estimateInlineOverflowLayerHeight(itemCount) {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 0;
  return (
    itemCount * INLINE_OVERFLOW_LAYER_ITEM_HEIGHT
    + (itemCount - 1) * INLINE_OVERFLOW_LAYER_GAP
    + INLINE_OVERFLOW_LAYER_PADDING * 2
    + INLINE_OVERFLOW_LAYER_BORDER_WIDTH * 2
  );
}

function resolveBoundaryCarry({
  triggerElement,
  hiddenItemCount,
}) {
  const monthBlock = triggerElement?.closest?.("[data-month-block]");
  if (!monthBlock) return false;

  const triggerRect = triggerElement?.getBoundingClientRect?.();
  const monthBlockRect = monthBlock.getBoundingClientRect?.();
  if (!triggerRect || !monthBlockRect) return false;

  const layerBottom = triggerRect.top + estimateInlineOverflowLayerHeight(hiddenItemCount);
  return layerBottom > monthBlockRect.bottom;
}

export function resolveOverflowPresentation({
  triggerElement,
  layout,
  containerElement,
  hiddenItemCount,
  boundaryColor,
}) {
  if (layout?.stacked) return { mode: "fallback", inlineAnchor: null };
  if (!triggerElement?.isConnected) return null;

  const inlineAnchor = resolveInlineOverflowAnchor(triggerElement, containerElement);
  if (!inlineAnchor) return null;
  if (Number.isFinite(hiddenItemCount) || boundaryColor) {
    return {
      mode: "inline",
      inlineAnchor,
      carryBoundaryToBottom: resolveBoundaryCarry({
        triggerElement,
        hiddenItemCount,
      }),
      boundaryColor,
    };
  }
  return { mode: "inline", inlineAnchor };
}

export function formatCellDate(viewYear, viewMonth, day) {
  return new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatCellDateKey(dateKey) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return "";
  return new Date(parsed.year, parsed.month, parsed.day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function buildCellAriaLabel({
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

export function getCellGhosts(ghostPreview, dateKey) {
  if (!dateKey || !ghostPreview?.ghosts?.length) return [];
  return ghostPreview.ghosts.filter((ghost) => {
    if (ghost.kind === "deadline") return ghost.startDate === dateKey;
    return ghost.kind === "event" && ghost.startDate === dateKey && ghost.startDate === ghost.endDate && !isPinnedCalendarGhost(ghost);
  });
}

export function buildCalendarMonthCells({
  cellCount,
  currentMonth,
  currentYear,
  firstDay,
  viewMonth,
  viewYear,
}) {
  const viewedMonthIsActualCurrentMonth =
    viewYear === currentYear && viewMonth === currentMonth;

  return Array.from({ length: cellCount }, (_, index) => {
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
    const showMonthPrefix = parsed.day === 1 && index >= 1 && index < 7;
    return {
      day: parsed.day,
      dateKey,
      dateLabel: showMonthPrefix
        ? `${monthLabel} ${parsed.day}`
        : String(parsed.day),
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
      dateLabel:
        cell.adjacentPosition === "trailing" && cell.day === 1
          ? `${cell.monthLabel} ${cell.day}`
          : cell.dateLabel,
      boundarySides: sides,
      boundaryColor:
        viewedMonthIsActualCurrentMonth || cell.inActualCurrentMonth
          ? CURRENT_MONTH_BOUNDARY_COLOR
          : OTHER_MONTH_BOUNDARY_COLOR,
    };
  });
}
