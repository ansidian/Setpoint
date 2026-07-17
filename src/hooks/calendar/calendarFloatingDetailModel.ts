import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import type { CalendarView } from "../../../shared/types/calendar";

export type FloatingDetailMode = "detail" | "create" | "edit" | string;
export type FloatingDetailSide = "left" | "right";
export type FloatingDetailKind = "deadline" | "transaction" | null;

export interface CalendarFloatingDetailState {
  open?: boolean;
  mode?: FloatingDetailMode;
  view?: string;
  dateKey?: string | null;
  itemId?: string | number | null;
  anchorKind?: string | null;
  anchorElement?: HTMLElement | null;
  userDragged?: boolean;
  dirty?: boolean;
  sideIntent?: string | null;
  forcedSide?: FloatingDetailSide | null;
  preferredSide?: FloatingDetailSide | null;
  initialPlacement?: { caretSide?: string | null } | null;
}

// Anchor contract with CalendarCell: the cell root renders role="gridcell"
// plus data-date-key (CalendarCell), and the floating-detail hook resolves
// editor anchors through this selector. Covered by
// useCalendarFloatingDetail.anchor.test.jsx — change both sides together.
export function dateCellSelector(dateKey: string): string {
  return `[role='gridcell'][data-date-key='${dateKey}']`;
}

export function isFloatingDetailTriggerTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment'], [data-testid='calendar-agenda-event-row'], [data-testid='calendar-agenda-event-chip'], [data-testid='calendar-agenda-bill-row'], [data-testid='calendar-agenda-deadline-row'], [data-calendar-overflow-trigger='true']");
}

export function isFloatingDetailActiveAnchorTarget(
  target: EventTarget | null,
  detail: CalendarFloatingDetailState | null | undefined,
): boolean {
  return target instanceof HTMLElement
    && !!detail?.anchorElement
    && detail.anchorElement.contains(target);
}

export function isFloatingDetailPanelTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

export function isGridOriginAnchorKind(anchorKind: string | null | undefined): boolean {
  return ["chip", "span", "overflow-row"].includes(String(anchorKind || ""));
}

export function isGridOriginFloatingDetail(detail: CalendarFloatingDetailState | null | undefined): boolean {
  if (!detail?.open || detail.mode !== "detail" || detail.userDragged) return false;
  return isGridOriginAnchorKind(detail.anchorKind);
}

export function floatingDetailOwnsGridSelection(detail: CalendarFloatingDetailState | null | undefined): boolean {
  if (!detail?.open || detail.mode !== "detail" || detail.itemId == null || !detail.dateKey) return false;
  return isGridOriginFloatingDetail(detail);
}

export function placementSideFromCaret(caretSide: string | null | undefined): FloatingDetailSide | null {
  if (caretSide === "left") return "right";
  if (caretSide === "right") return "left";
  return null;
}

export function preservedReanchorSide(
  current: CalendarFloatingDetailState | null | undefined,
  nextDetail: CalendarFloatingDetailState,
  nextView: string,
  nextDateKey: string | null,
): FloatingDetailSide | null {
  if (!current?.open || current.mode !== "detail" || current.userDragged || current.dirty) return null;
  if (current.sideIntent === "user-flip") return null;
  if (current.view !== nextView || current.dateKey !== nextDateKey) return null;
  if (!isGridOriginAnchorKind(current.anchorKind) || !isGridOriginAnchorKind(nextDetail.anchorKind)) return null;
  return current.forcedSide
    || placementSideFromCaret(current.initialPlacement?.caretSide)
    || current.preferredSide
    || null;
}

export function floatingDetailTypeLabel(view: CalendarView | string, detailKind: FloatingDetailKind = null): string {
  if (detailKind === "deadline") return "Deadline";
  if (detailKind === "transaction") return "Transaction";
  if (view === "events") return "Event";
  if (view === "bills") return "Bill";
  return "Item";
}

function dateForFloatingLabel(
  dateKey: string | null | undefined,
  viewYear: number,
  viewMonth: number,
  selectedDay: number | null | undefined,
): Date | null {
  const parsed = parseYmd(dateKey);
  return parsed
    ? new Date(parsed.year, parsed.month, parsed.day)
    : selectedDay
      ? new Date(viewYear, viewMonth, selectedDay)
      : null;
}

function formatFloatingLabelDate(
  dateKey: string | null | undefined,
  viewYear: number,
  viewMonth: number,
  selectedDay: number | null | undefined,
): string {
  const date = dateForFloatingLabel(dateKey, viewYear, viewMonth, selectedDay);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Selected";
}

export function formatFloatingDetailLabel(
  view: CalendarView | string,
  dateKey: string | null | undefined,
  viewYear: number,
  viewMonth: number,
  selectedDay: number | null | undefined,
  detailKind: FloatingDetailKind = null,
): string {
  return `${floatingDetailTypeLabel(view, detailKind)} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}

export function formatFloatingEditorLabel(
  mode: FloatingDetailMode,
  view: CalendarView | string,
  dateKey: string | null | undefined,
  viewYear: number,
  viewMonth: number,
  selectedDay: number | null | undefined,
  detailKind: FloatingDetailKind = null,
): string {
  const action = mode === "create" ? "New" : "Edit";
  const type = floatingDetailTypeLabel(view, detailKind).toLowerCase();
  return `${action} ${type} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}
