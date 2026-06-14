import { parseYmd } from "../../components/calendar/calendarDateUtils.js";

// Anchor contract with CalendarCell: the cell root renders role="gridcell"
// plus data-date-key (CalendarCell.jsx), and the floating-detail hook resolves
// editor anchors through this selector. Covered by
// useCalendarFloatingDetail.anchor.test.jsx — change both sides together.
export function dateCellSelector(dateKey) {
  return `[role='gridcell'][data-date-key='${dateKey}']`;
}

export function isFloatingDetailTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment'], [data-testid='calendar-agenda-event-row'], [data-testid='calendar-agenda-event-chip'], [data-testid='calendar-agenda-bill-row'], [data-testid='calendar-agenda-deadline-row'], [data-calendar-overflow-trigger='true']");
}

export function isFloatingDetailActiveAnchorTarget(target, detail) {
  return target instanceof HTMLElement
    && !!detail?.anchorElement
    && detail.anchorElement.contains(target);
}

export function isFloatingDetailPanelTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

export function isGridOriginAnchorKind(anchorKind) {
  return ["chip", "span", "overflow-row"].includes(String(anchorKind || ""));
}

export function isGridOriginFloatingDetail(detail) {
  if (!detail?.open || detail.mode !== "detail" || detail.parked || detail.userDragged) return false;
  return isGridOriginAnchorKind(detail.anchorKind);
}

export function floatingDetailOwnsGridSelection(detail) {
  if (!detail?.open || detail.mode !== "detail" || detail.itemId == null || !detail.dateKey) return false;
  if (detail.parked) return true;
  return isGridOriginFloatingDetail(detail);
}

export function placementSideFromCaret(caretSide) {
  if (caretSide === "left") return "right";
  if (caretSide === "right") return "left";
  return null;
}

export function preservedReanchorSide(current, nextDetail, nextView, nextDateKey) {
  if (!current?.open || current.mode !== "detail" || current.parked || current.userDragged || current.dirty) return null;
  if (current.sideIntent === "user-flip") return null;
  if (current.view !== nextView || current.dateKey !== nextDateKey) return null;
  if (!isGridOriginAnchorKind(current.anchorKind) || !isGridOriginAnchorKind(nextDetail.anchorKind)) return null;
  return current.forcedSide
    || placementSideFromCaret(current.initialPlacement?.caretSide)
    || current.preferredSide
    || null;
}

export function floatingDetailTypeLabel(view, detailKind = null) {
  if (detailKind === "deadline") return "Deadline";
  if (view === "events") return "Event";
  if (view === "bills") return "Bill";
  return "Item";
}

function dateForFloatingLabel(dateKey, viewYear, viewMonth, selectedDay) {
  const parsed = parseYmd(dateKey);
  return parsed
    ? new Date(parsed.year, parsed.month, parsed.day)
    : selectedDay
      ? new Date(viewYear, viewMonth, selectedDay)
      : null;
}

function formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay) {
  const date = dateForFloatingLabel(dateKey, viewYear, viewMonth, selectedDay);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Selected";
}

export function formatFloatingDetailLabel(view, dateKey, viewYear, viewMonth, selectedDay, detailKind = null) {
  return `${floatingDetailTypeLabel(view, detailKind)} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}

export function formatFloatingEditorLabel(mode, view, dateKey, viewYear, viewMonth, selectedDay, detailKind = null) {
  const action = mode === "create" ? "New" : "Edit";
  const type = floatingDetailTypeLabel(view, detailKind).toLowerCase();
  return `${action} ${type} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}
