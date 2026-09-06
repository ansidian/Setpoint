import { parseYmd, ymdFromParts } from "../calendarDateUtils.ts";
import { isPinnedCalendarGhost } from "./calendarEventSpanLayout";

export const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const CELL_HEADER_HEIGHT = 24;
export const CURRENT_MONTH_BOUNDARY_COLOR = "#0095FF";
export const OTHER_MONTH_BOUNDARY_COLOR = "color-mix(in srgb, var(--sp-blue) 32%, transparent)";
const INLINE_OVERFLOW_LAYER_PADDING = 4;
const INLINE_OVERFLOW_LAYER_BORDER_WIDTH = 1;
const INLINE_OVERFLOW_LAYER_ITEM_HEIGHT = 36;
const INLINE_OVERFLOW_LAYER_GAP = 4;

export interface CalendarInlineOverflowAnchor { top: number; left: number; width: number }

export interface CalendarOverflowStateLike {
  dateKey?: string | null;
  day?: number;
  view?: string;
  viewYear?: number;
  viewMonth?: number;
  mode?: "inline" | "fallback" | string;
  inlineAnchor?: CalendarInlineOverflowAnchor | null;
  sourceCellElement?: Element | null;
  triggerElement?: Element | null;
}

export type CalendarBoundarySide = "left" | "right" | "top" | "bottom";

export interface CalendarMonthCell {
  day: number;
  dateKey: string;
  dateLabel: string;
  inCurrentMonth: boolean;
  inActualCurrentMonth: boolean;
  boundarySides: CalendarBoundarySide[];
  boundaryColor?: string;
  monthLabel: string;
  adjacentPosition: "current" | "leading" | "trailing";
}

export function sameOverflowDate(overflow: CalendarOverflowStateLike | null, dateKey?: string | null, day?: number): boolean {
  if (!overflow) return false;
  if (overflow.dateKey && dateKey) return overflow.dateKey === dateKey;
  return overflow.day === day;
}

export function overflowStateIsLiveInScope(overflow: CalendarOverflowStateLike | null, { view, viewYear, viewMonth }: { view?: string; viewYear?: number; viewMonth?: number } = {}): boolean {
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

export function spanCoversOverflowDate(overflow: CalendarOverflowStateLike | null, segment: { segmentStart?: string; segmentEnd?: string } | null): boolean {
  if (!overflow || !segment) return false;
  if (overflow.dateKey && segment.segmentStart && segment.segmentEnd) {
    return segment.segmentStart <= overflow.dateKey && overflow.dateKey <= segment.segmentEnd;
  }
  return false;
}

export function overflowHiddenSignature(items: readonly { id?: unknown }[] | null | undefined): string {
  return (items || []).map((item) => String(item.id)).join("\u001f");
}

interface OverflowCompletionItem {
  complete?: boolean;
  sourceItem?: Record<string, unknown>;
}

export function overflowCompletionSignature(items: readonly OverflowCompletionItem[]): string {
  return items.map((item) => `${!!item.sourceItem?._completing}:${!!item.complete}`).join("\u001f");
}

export function getModalScrollContainer(element: Element | null | undefined): Element | null {
  const panel = element?.closest?.("[data-testid='calendar-modal-panel']");
  const body = panel?.querySelector?.("[data-testid='calendar-modal-body']");
  return body?.parentElement || null;
}

export function isCalendarRailTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-modal-rail']");
}

export function isCalendarGridCellTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[role='gridcell']");
}

export function isCalendarFloatingDetailTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

export function isCalendarInlineOverflowTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-inline-overflow-layer='true']");
}

export function isCalendarEventSpanTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest(
      "[data-testid='calendar-event-span-segment'], [data-testid='calendar-event-span-overlay']",
    );
}

export function resolveInlineOverflowAnchor(triggerElement?: Element | null, containerElement?: Element | null): CalendarInlineOverflowAnchor | null {
  const triggerRect = triggerElement?.getBoundingClientRect?.();
  const containerRect = containerElement?.getBoundingClientRect?.();
  if (!triggerRect || !containerRect) return null;
  return {
    top: triggerRect.top - containerRect.top,
    left: triggerRect.left - containerRect.left - 4,
    width: triggerRect.width + 8,
  };
}

function estimateInlineOverflowLayerHeight(itemCount = 0): number {
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
}: { triggerElement?: Element | null; hiddenItemCount?: number }): boolean {
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
}: { triggerElement?: Element | null; layout?: { stacked?: boolean } | null; containerElement?: Element | null; hiddenItemCount?: number; boundaryColor?: string | null }): { mode: "inline" | "fallback"; inlineAnchor: CalendarInlineOverflowAnchor | null; carryBoundaryToBottom?: boolean; boundaryColor?: string | null } | null {
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

export function formatCellDate(viewYear: number, viewMonth: number, day: number): string {
  return new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatCellDateKey(dateKey: string): string {
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
}: { viewLabel?: string; viewYear: number; viewMonth: number; day: number; dateKey?: string | null; itemCount: number; isSelected: boolean; isToday: boolean }): string {
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

export interface CalendarGhostLike {
  id?: unknown;
  kind?: string;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  [key: string]: unknown;
}

export function getCellGhosts(ghostPreview: { ghosts?: CalendarGhostLike[] } | null | undefined, dateKey?: string | null): CalendarGhostLike[] {
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
}: { cellCount: number; currentMonth: number; currentYear: number; firstDay: number; viewMonth: number; viewYear: number }): CalendarMonthCell[] {
  const viewedMonthIsActualCurrentMonth =
    viewYear === currentYear && viewMonth === currentMonth;

  const baseCells: CalendarMonthCell[] = Array.from({ length: cellCount }, (_, index): CalendarMonthCell => {
    const date = new Date(Date.UTC(viewYear, viewMonth, 1, 12));
    date.setUTCDate(date.getUTCDate() - firstDay + index);
    const dateKey = date.toISOString().slice(0, 10);
    const parsed = parseYmd(dateKey)!;
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
  });
  return baseCells.map((cell, index, cells): CalendarMonthCell => {
    if (cell.inCurrentMonth) return cell;
    const sides: CalendarBoundarySide[] = [];
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
