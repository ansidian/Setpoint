import { parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { isPinnedCalendarGhost } from "./calendarEventSpanLayout.js";

export const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const GRID_ROWS = 6;
export const CELL_HEADER_HEIGHT = 24;
const MONTH_WHEEL_NOTCH_MIN_PX = 1;
export const MONTH_WHEEL_COOLDOWN_MS = 180;
const MONTH_WHEEL_INTENT_INTERVAL_MS = 100;
const WHEEL_LINE_PX = 32;
export const CURRENT_MONTH_BOUNDARY_COLOR = "#0095FF";
export const OTHER_MONTH_BOUNDARY_COLOR = "rgba(137,180,250,0.32)";
const INLINE_OVERFLOW_PANEL_PADDING = 12;

export function createMonthWheelState() {
  return {
    lastNavigateAt: -Infinity,
    ignoreUntil: -Infinity,
    lastWheelAt: -Infinity,
    lastWheelDelta: 0,
  };
}

export function normalizeWheelDeltaY(event, fallbackPagePx) {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_PX;
  if (event.deltaMode === 2) return event.deltaY * fallbackPagePx;
  return event.deltaY;
}

export function isCoarseMonthWheel(event, normalizedY) {
  if (!Number.isFinite(normalizedY)) return false;
  if (Math.abs(normalizedY) < MONTH_WHEEL_NOTCH_MIN_PX) return false;

  if (event.deltaMode !== 0) return true;

  if (event.deltaMode === 0 && !Number.isInteger(event.deltaY)) {
    return false;
  }

  return true;
}

export function isIntentionalMonthWheel({ normalizedY, now, wheelState }) {
  const lastDelta = wheelState.lastWheelDelta || 0;
  const rapidSuccession =
    now - wheelState.lastWheelAt < MONTH_WHEEL_INTENT_INTERVAL_MS;
  const sameDirection = Math.sign(lastDelta) === Math.sign(normalizedY);
  const tapering = Math.abs(normalizedY) <= Math.abs(lastDelta);

  return !rapidSuccession || !sameDirection || !tapering;
}

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

export function isCalendarEventSpanTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest(
      "[data-testid='calendar-event-span-segment'], [data-testid='calendar-event-span-overlay']",
    );
}

export function canUseInlineOverflow({ triggerElement, hiddenStackHeight, layout }) {
  if (layout?.stacked || !triggerElement?.isConnected) return false;
  if (!Number.isFinite(hiddenStackHeight) || hiddenStackHeight <= 0) return false;

  const panel = triggerElement.closest("[data-testid='calendar-modal-panel']");
  const panelRect = panel?.getBoundingClientRect?.();
  const triggerRect = triggerElement.getBoundingClientRect();
  if (!panelRect) return false;

  return triggerRect.top + hiddenStackHeight <= panelRect.bottom - INLINE_OVERFLOW_PANEL_PADDING;
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

export function resolveOverflowPresentation({
  triggerElement,
  hiddenStackHeight,
  layout,
  containerElement,
}) {
  if (layout?.stacked) return { mode: "fallback", inlineAnchor: null };
  if (!triggerElement?.isConnected) return null;
  if (!Number.isFinite(hiddenStackHeight) || hiddenStackHeight <= 0) return null;

  const panel = triggerElement.closest("[data-testid='calendar-modal-panel']");
  const panelRect = panel?.getBoundingClientRect?.();
  if (!panelRect) return null;

  const inlineFits = canUseInlineOverflow({
    triggerElement,
    hiddenStackHeight,
    layout,
  });
  if (!inlineFits) return { mode: "fallback", inlineAnchor: null };

  const inlineAnchor = resolveInlineOverflowAnchor(triggerElement, containerElement);
  if (!inlineAnchor) return null;
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
