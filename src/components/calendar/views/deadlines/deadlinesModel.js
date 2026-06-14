import { parseDueDate } from "../../../../lib/dashboard-helpers";
import { dueDateToMs } from "../../../../lib/shell-helpers";
import { isDemoMode } from "../../../../demo/config.js";
import { parseYmd } from "../../calendarDateUtils.js";
import { TODOIST_DEADLINE_COLOR } from "../../../../../shared/deadline-source-colors.js";

export const MAX_PILLS = 2;

export const DEADLINE_COLOR = TODOIST_DEADLINE_COLOR;

export const PRIORITY_META = {
  1: { color: "#f38ba8", label: "P1 · Urgent" },
  2: { color: "#f9e2af", label: "P2 · High" },
  3: { color: "#89b4fa", label: "P3 · Medium" },
};

export function sourceOf(task) {
  return task?.source || "deadline";
}

export function deadlineAccentFor(task, fallback = DEADLINE_COLOR) {
  return task?.color || task?.sourceColor || fallback || DEADLINE_COLOR;
}

export function normalizeStatus(status) {
  if (status === "open") return "incomplete";
  return status || "incomplete";
}

export function statusLabel(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "complete") return "Complete";
  if (normalized === "in_progress") return "In progress";
  return "Incomplete";
}

export function openInNewTab(url) {
  if (!url) return;
  if (isDemoMode()) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function formatFullDate(year, month, day, selectedDateKey) {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) {
    const d = new Date(parsed.year, parsed.month, parsed.day);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  if (day == null) return "Selected deadline";
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function deadlineItemsFromData(data) {
  if (Array.isArray(data?.upcoming)) return data.upcoming;
  return [];
}

export function getDeadlineOccurrenceDate(task, dateKey = null) {
  return dateKey || task?.agendaDateKey || task?.due_date || task?.dueDate || task?.date || "undated";
}

export function getDeadlineSelectionId(task, dateKey = null) {
  if (!task || task.id == null) return null;
  if (String(task.agendaItemId || "").startsWith("deadline:")) return String(task.agendaItemId);
  const occurrenceDateKey = getDeadlineOccurrenceDate(task, dateKey);
  return `deadline:${task.id}:${occurrenceDateKey}`;
}

export function deadlineMatchesItemId(task, itemId, dateKey = null) {
  if (!task || itemId == null) return false;
  const target = String(itemId);
  const occurrenceDateKey = getDeadlineOccurrenceDate(task, dateKey);
  const legacySource = sourceOf(task);
  const legacyIds = [
    `${legacySource}:${task.id}-${occurrenceDateKey}`,
    `${legacySource}:${task.id}`,
  ];
  return String(getDeadlineSelectionId(task, dateKey)) === target
    || String(task.agendaItemId || "") === target
    || String(task.id) === target
    || legacyIds.includes(target);
}

function orderDeadlines(items = []) {
  return [...items].sort((a, b) => {
    const aMs = dueDateToMs(a.due_date, a.due_time) ?? Number.POSITIVE_INFINITY;
    const bMs = dueDateToMs(b.due_date, b.due_time) ?? Number.POSITIVE_INFINITY;
    if (aMs !== bMs) return aMs - bMs;
    const aComplete = normalizeStatus(a.status) === "complete" ? 1 : 0;
    const bComplete = normalizeStatus(b.status) === "complete" ? 1 : 0;
    if (aComplete !== bComplete) return aComplete - bComplete;
    return (a.title || "").localeCompare(b.title || "");
  });
}

function groupDeadlines(items = []) {
  const ordered = orderDeadlines(items);
  const activeItems = ordered.filter((item) => normalizeStatus(item.status) !== "complete");
  const completedItems = ordered.filter((item) => normalizeStatus(item.status) === "complete");
  return {
    items: ordered,
    activeItems,
    completedItems,
    activeCount: activeItems.length,
    completedCount: completedItems.length,
    totalCount: ordered.length,
  };
}

export function getDayState(rawItems) {
  if (rawItems?.activeItems) return rawItems;
  return groupDeadlines(Array.isArray(rawItems) ? rawItems : []);
}

export function getDefaultSelectedItemId(items = []) {
  const state = getDayState(items);
  const firstOpen = state.activeItems[0];
  const fallback = firstOpen || state.completedItems[0];
  return getDeadlineSelectionId(fallback) || "";
}

export function compute({ data, viewYear, viewMonth }) {
  const all = deadlineItemsFromData(data);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const itemsByDay = {};
  const itemsByDate = {};
  let earliestOverdue = null;
  for (const task of all) {
    if (!task.due_date) continue;
    const dueDate = parseDueDate(task.due_date);
    if (Number.isNaN(dueDate.getTime())) continue;

    if (normalizeStatus(task.status) !== "complete" && dueDate < today) {
      if (!earliestOverdue || dueDate < earliestOverdue) earliestOverdue = dueDate;
    }

    const day = dueDate.getDate();
    if (!itemsByDate[task.due_date]) itemsByDate[task.due_date] = [];
    itemsByDate[task.due_date].push(task);
    if (dueDate.getFullYear() !== viewYear || dueDate.getMonth() !== viewMonth) continue;
    if (!itemsByDay[day]) itemsByDay[day] = [];
    itemsByDay[day].push(task);
  }

  for (const day of Object.keys(itemsByDay)) {
    itemsByDay[day] = groupDeadlines(itemsByDay[day]);
  }
  for (const dateKey of Object.keys(itemsByDate)) {
    itemsByDate[dateKey] = groupDeadlines(itemsByDate[dateKey]);
  }

  return { itemsByDay, itemsByDate, earliestOverdue };
}

export function canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data, computed }) {
  const currentIdx = currentYear * 12 + currentMonth;
  const viewIdx = viewYear * 12 + viewMonth;
  if (viewIdx > currentIdx) return true;
  let minIdx = currentIdx - 12;
  if (data?.minDate) {
    const min = parseDueDate(data.minDate);
    if (!Number.isNaN(min.getTime())) {
      minIdx = min.getFullYear() * 12 + min.getMonth();
    }
    return viewIdx > minIdx;
  }
  const earliest = computed?.earliestOverdue;
  if (!earliest) return viewIdx > minIdx;
  const earliestIdx = earliest.getFullYear() * 12 + earliest.getMonth();
  return viewIdx > earliestIdx;
}

export function hasOverdue(items) {
  const state = getDayState(items);
  return state.activeItems.some((task) => task._overdueHint);
}

export function allComplete(_items) {
  return false;
}
