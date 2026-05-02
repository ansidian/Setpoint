import { parseYmd } from "../../components/calendar/calendarDateUtils.js";

export function isFloatingDetailTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment'], [data-testid='calendar-agenda-event-row'], [data-testid='calendar-agenda-event-chip'], [data-testid='calendar-agenda-bill-row'], [data-testid='calendar-agenda-deadline-row']");
}

export function isFloatingDetailPanelTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

function gridOriginTriggerMatchesDetail(trigger, detail) {
  if (!trigger || !detail) return false;
  if (detail.anchorElement === trigger) return true;

  const triggerItemId = trigger.getAttribute("data-item-id");
  if (!triggerItemId || detail.itemId == null || String(triggerItemId) !== String(detail.itemId)) {
    return false;
  }

  const triggerDateKey = trigger.getAttribute("data-date-key")
    || trigger.closest("[role='gridcell']")?.getAttribute("data-date-key")
    || null;
  const segmentStart = trigger.getAttribute("data-segment-start");
  const segmentEnd = trigger.getAttribute("data-segment-end");
  if (detail.dateKey && segmentStart && segmentEnd) {
    return segmentStart <= detail.dateKey && detail.dateKey <= segmentEnd;
  }
  return !triggerDateKey || !detail.dateKey || triggerDateKey === detail.dateKey;
}

export function isFloatingDetailFlipSuppressedTarget(target, detail) {
  if (!(target instanceof HTMLElement)) return false;
  const gridOriginTrigger = target.closest(
    "[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment']",
  );
  if (gridOriginTrigger && gridOriginTriggerMatchesDetail(gridOriginTrigger, detail)) return false;

  return !!target.closest([
      "[data-calendar-floating-detail='true']",
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='button']",
      "[role='link']",
      "[role='menu']",
      "[role='menuitem']",
      "[role='listbox']",
      "[role='option']",
      "[data-suspend-calendar-hotkeys='true']",
    ].join(", "));
}

export function isGridOriginAnchorKind(anchorKind) {
  return ["chip", "span", "overflow-row"].includes(String(anchorKind || ""));
}

export function isGridOriginFloatingDetail(detail) {
  if (!detail?.open || detail.mode !== "detail" || detail.parked || detail.userDragged) return false;
  return isGridOriginAnchorKind(detail.anchorKind);
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

export function floatingDetailTypeLabel(view) {
  if (view === "events") return "Event";
  if (view === "bills") return "Bill";
  if (view === "deadlines") return "Deadline";
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

export function formatFloatingDetailLabel(view, dateKey, viewYear, viewMonth, selectedDay) {
  return `${floatingDetailTypeLabel(view)} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}

export function formatFloatingEditorLabel(mode, view, dateKey, viewYear, viewMonth, selectedDay) {
  const action = mode === "create" ? "New" : "Edit";
  const type = floatingDetailTypeLabel(view).toLowerCase();
  return `${action} ${type} · ${formatFloatingLabelDate(dateKey, viewYear, viewMonth, selectedDay)}`;
}
