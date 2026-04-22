import { parseDueDate } from "../../../../lib/dashboard-helpers";
import { dueDateToMs } from "../../../../lib/redesign-helpers";

export const MAX_PILLS = 2;

export const SOURCE_COLORS = {
  canvas: "#5A8FBF",
  manual: "#5A8FBF",
  todoist: "#e8776a",
};

export const PRIORITY_META = {
  1: { color: "#f38ba8", label: "P1 · Urgent" },
  2: { color: "#f9e2af", label: "P2 · High" },
  3: { color: "#89b4fa", label: "P3 · Medium" },
};

export function sourceOf(task) {
  return task?.source || "canvas";
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
  window.open(url, "_blank", "noopener,noreferrer");
}

export function formatFullDate(year, month, day) {
  if (day == null) return "Selected deadline";
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function sourceLabelFor(task) {
  const source = sourceOf(task);
  return source === "todoist" ? "Todoist" : source === "canvas" ? "Canvas" : "CTM";
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
  return String(fallback?.id || "");
}

export function compute({ data, viewYear, viewMonth }) {
  const ctmItems = data?.ctm?.upcoming || [];
  const todoistItems = data?.todoist?.upcoming || [];
  const all = [...ctmItems, ...todoistItems];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const itemsByDay = {};
  let earliestOverdue = null;
  for (const task of all) {
    if (!task.due_date) continue;
    const dueDate = parseDueDate(task.due_date);
    if (Number.isNaN(dueDate.getTime())) continue;

    if (normalizeStatus(task.status) !== "complete" && dueDate < today) {
      if (!earliestOverdue || dueDate < earliestOverdue) earliestOverdue = dueDate;
    }

    if (dueDate.getFullYear() !== viewYear || dueDate.getMonth() !== viewMonth) continue;
    const day = dueDate.getDate();
    if (!itemsByDay[day]) itemsByDay[day] = [];
    itemsByDay[day].push(task);
  }

  for (const day of Object.keys(itemsByDay)) {
    itemsByDay[day] = groupDeadlines(itemsByDay[day]);
  }

  return { itemsByDay, earliestOverdue };
}

export function canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, computed }) {
  const currentIdx = currentYear * 12 + currentMonth;
  const viewIdx = viewYear * 12 + viewMonth;
  if (viewIdx > currentIdx) return true;
  const earliest = computed?.earliestOverdue;
  if (!earliest) return false;
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
