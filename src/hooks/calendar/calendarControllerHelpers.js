// Pure, stateless helpers extracted from useCalendarModalController.jsx
// (fe-global::calendar-controller-god-component). These were module-scope
// functions in the controller; moving them here shrinks the orchestrator
// without changing any behavior. Each function is a pure transform over its
// arguments and is unit-testable directly.
import billsView from "../../components/calendar/views/billsView.jsx";
import eventsView from "../../components/calendar/views/eventsView.jsx";
import { deadlineItemsFromData } from "../../components/calendar/views/deadlines/deadlinesModel.js";

export const VIEWS = {
  events: eventsView,
  bills: billsView,
};
export const SCROLL_IDLE_THRESHOLD_MS = 400;

export function addMonthOffset(year, month, offset) {
  const date = new Date(year, month + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function eventCacheKey(event) {
  if (!event?.id) return null;
  return event.originalStartTime ? `${event.id}::${event.originalStartTime}` : String(event.id);
}

export function dedupeEvents(events) {
  const seen = new Set();
  const result = [];
  for (const event of events) {
    const key = eventCacheKey(event);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(event);
  }
  return result;
}

export function itemsFromDatePool(activeView, pool) {
  if (!pool) return [];
  if (Array.isArray(pool)) return pool;
  if (Array.isArray(pool.items)) return pool.items;
  const state = activeView?.getDayState?.(pool);
  if (Array.isArray(state?.items)) return state.items;
  return [];
}

export function isCompleteItem(item) {
  return item?.status === "complete";
}

export function itemDueDate(item) {
  return item?.agendaDateKey || item?.due_date || item?.next_date || null;
}

function rawDeadlineIdFromOccurrenceId(itemId) {
  const text = String(itemId || "");
  if (!text.startsWith("deadline:")) return null;
  const lastColon = text.lastIndexOf(":");
  if (lastColon <= "deadline:".length) return null;
  return text.slice("deadline:".length, lastColon) || null;
}

export function itemFromCalendarSearchResult(result) {
  if (!result) return null;
  if (result.type === "event") {
    return {
      ...(result.payload || {}),
      id: result.itemId,
      title: result.title,
      agendaDateKey: result.itemDate,
      startMs: result.payload?.startMs,
      endMs: result.payload?.endMs,
      allDay: !!result.payload?.allDay,
      location: result.location || "",
      source: result.sourceLabel || result.meta || "Calendar",
      sourceColor: result.sourceColor,
      color: result.sourceColor,
      time: result.subtitle || "",
    };
  }
  if (result.type === "deadline") {
    const rawDeadlineId = result.payload?.id || result.activation?.deadlineId || result.rawDeadlineId || result.itemId;
    return {
      ...(result.payload || {}),
      id: rawDeadlineId,
      agendaItemId: result.itemId,
      title: result.title,
      agendaDateKey: result.itemDate,
      due_date: result.itemDate,
      class_name: result.subtitle || "",
      status: result.status || result.payload?.status || "open",
    };
  }
  if (result.type === "bill") {
    return {
      ...(result.payload || {}),
      id: result.itemId,
      name: result.title,
      title: result.title,
      agendaDateKey: result.itemDate,
      next_date: result.itemDate,
      payee: result.subtitle || "",
    };
  }
  return {
    id: result.itemId || result.id,
    title: result.title,
    agendaDateKey: result.itemDate,
  };
}

export function rangeMatches(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end;
}

export function makeDeadlineOverlayRecord(data, range) {
  return data && range ? { data, range } : null;
}

export const EMPTY_CALENDAR_EVENTS = [];

export function deadlineOverlayRecordData(record, visibleRange) {
  if (!record) return null;
  if (record.range && !rangeMatches(record.range, visibleRange)) return null;
  return record.data || record;
}

export function hasDeadlineItemsInRange(data, range) {
  if (!data || !range) return false;
  for (const item of deadlineItemsFromData(data)) {
    const dueDate = item?.agendaDateKey || item?.due_date || item?.dueDate || item?.date;
    if (dueDate && dueDate >= range.start && dueDate <= range.end) return true;
  }
  return false;
}

export function resolvePendingFocusItem({ activeView, computed, dateKey, itemId }) {
  const getItemId = activeView?.getItemId || ((item) => item?.id);
  const matches = (item) => (
    activeView?.matchesItemId?.(item, itemId)
    || String(getItemId(item)) === String(itemId)
    || String(item?.id) === String(itemId)
  );
  const sameDateCandidates = itemsFromDatePool(activeView, computed?.itemsByDate?.[dateKey]);
  const sameDateOpen = sameDateCandidates.find((item) => matches(item) && !isCompleteItem(item));
  if (sameDateOpen) return sameDateOpen;

  const allByDate = computed?.itemsByDate || {};
  const allMatches = Object.entries(allByDate)
    .flatMap(([candidateDateKey, pool]) => (
      itemsFromDatePool(activeView, pool)
        .filter((item) => matches(item))
        .map((item) => ({ item, candidateDateKey }))
    ));
  const openMatch = allMatches.find(({ item }) => !isCompleteItem(item));
  if (openMatch) return openMatch.item;

  const rawDeadlineId = rawDeadlineIdFromOccurrenceId(itemId);
  if (rawDeadlineId && allMatches.some(({ item }) => isCompleteItem(item))) {
    const currentOccurrence = Object.values(allByDate)
      .flatMap((pool) => itemsFromDatePool(activeView, pool))
      .find((item) => String(item?.id) === rawDeadlineId && !isCompleteItem(item));
    if (currentOccurrence) return currentOccurrence;
  }

  return sameDateCandidates.find((item) => matches(item))
    || allMatches.find(({ item }) => itemDueDate(item) === dateKey)?.item
    || allMatches[0]?.item
    || null;
}

export function itemMatchesViewId(activeView, item, itemId) {
  if (!item || itemId == null) return false;
  const id = String(itemId);
  const getItemId = activeView?.getItemId || ((candidate) => candidate?.id);
  return activeView?.matchesItemId?.(item, id)
    || String(getItemId(item)) === id
    || String(item?.id) === id;
}

export function findItemLocation(activeView, computed, itemId, preferredDateKey = null) {
  if (itemId == null) return null;
  const matchInPool = (dateKey, pool) => {
    const item = itemsFromDatePool(activeView, pool)
      .find((candidate) => itemMatchesViewId(activeView, candidate, itemId));
    return item ? { dateKey, item } : null;
  };
  if (preferredDateKey) {
    const preferred = matchInPool(preferredDateKey, computed?.itemsByDate?.[preferredDateKey]);
    if (preferred) return preferred;
  }
  for (const [dateKey, pool] of Object.entries(computed?.itemsByDate || {})) {
    const location = matchInPool(dateKey, pool);
    if (location) return location;
  }
  return null;
}

export function findGridChipAnchor(panelElement, itemId, dateKey) {
  if (!panelElement || itemId == null || !dateKey) return null;
  const id = String(itemId);
  return [
    ...panelElement.querySelectorAll(
      "[data-testid='calendar-cell-item-chip'], [data-testid='calendar-event-span-segment']",
    ),
  ].find((element) => {
    if (String(element.getAttribute("data-item-id")) !== id) return false;
    const cell = element.closest?.("[role='gridcell']");
    return cell?.getAttribute("data-date-key") === dateKey;
  }) || null;
}
