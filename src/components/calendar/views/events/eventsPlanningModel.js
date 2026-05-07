import {
  getDayState,
  getDeadlineSelectionId,
  normalizeStatus,
  SOURCE_COLORS,
  sourceLabelFor,
  sourceOf,
  statusLabel,
} from "../deadlines/deadlinesModel.js";
import deadlinesView from "../deadlinesView.jsx";
import { dueDateToMs, getEventSelectionId } from "../../../../lib/redesign-helpers";

export function isDeadlinePlanningItem(item) {
  return item?.calendarItemKind === "deadline" || (!!item?.due_date && !item?.startMs);
}

export function getPlanningItemId(item) {
  if (isDeadlinePlanningItem(item)) return getDeadlineSelectionId(item, item.agendaDateKey || item.due_date);
  return getEventSelectionId(item);
}

export function deadlinePlanningAccent(task) {
  return SOURCE_COLORS[sourceOf(task)] || "#89b4fa";
}

export function deadlinePlanningTitle(task) {
  return task?.title || task?.name || "Untitled";
}

export function deadlinePlanningSubtitle(task) {
  return task?.project_name || task?.class_name || sourceLabelFor(task);
}

export function deadlinePlanningTimeLabel(task) {
  return task?.due_time || sourceLabelFor(task);
}

export function deadlinePlanningStatusIcon(status) {
  if (status === "complete") return "complete";
  if (status === "in_progress") return "in_progress";
  return null;
}

function cloneDeadlineForDate(task, dateKey) {
  return {
    ...task,
    calendarItemKind: "deadline",
    agendaDateKey: dateKey,
    agendaItemId: getDeadlineSelectionId(task, dateKey),
  };
}

function filteredDeadlineItems(rawItems, showCompleted) {
  const state = getDayState(rawItems);
  return (showCompleted ? state.items : state.activeItems).map((task) => (
    cloneDeadlineForDate(task, task.agendaDateKey || task.due_date)
  ));
}

export function getDeadlineOverlayComputed({ deadlineData, viewYear, viewMonth, showCompleted = true } = {}) {
  if (!deadlineData) return null;
  const computed = deadlinesView.compute({ data: deadlineData, viewYear, viewMonth });
  const itemsByDay = {};
  const itemsByDate = {};
  let totalDeadlines = 0;
  let activeDeadlines = 0;
  let completedDeadlines = 0;

  for (const [day, rawItems] of Object.entries(computed.itemsByDay || {})) {
    const state = getDayState(rawItems);
    const items = filteredDeadlineItems(rawItems, showCompleted);
    if (items.length) itemsByDay[day] = items;
    totalDeadlines += items.length;
    activeDeadlines += state.activeCount || 0;
    completedDeadlines += showCompleted ? state.completedCount || 0 : 0;
  }

  for (const [dateKey, rawItems] of Object.entries(computed.itemsByDate || {})) {
    const items = filteredDeadlineItems(rawItems, showCompleted)
      .map((task) => ({ ...task, agendaDateKey: dateKey, agendaItemId: getDeadlineSelectionId(task, dateKey) }));
    if (items.length) itemsByDate[dateKey] = items;
  }

  return {
    ...computed,
    itemsByDay,
    itemsByDate,
    totalDeadlines,
    activeDeadlines,
    completedDeadlines,
  };
}

function planningSortBucket(item) {
  if (!isDeadlinePlanningItem(item)) return item?.allDay ? 0 : 1;
  const complete = normalizeStatus(item.status) === "complete";
  if (complete) return 4;
  const dueMs = dueDateToMs(item.due_date, item.due_time);
  const dayStart = dueDateToMs(item.agendaDateKey || item.due_date, null);
  if (Number.isFinite(dueMs) && Number.isFinite(dayStart) && dueMs <= dayStart + 86400000 - 1) return 2;
  return 3;
}

function planningSortTime(item) {
  if (isDeadlinePlanningItem(item)) {
    return dueDateToMs(item.due_date, item.due_time) ?? Number.POSITIVE_INFINITY;
  }
  return item?.startMs || 0;
}

export function orderPlanningItems(items = []) {
  return [...items].sort((a, b) => {
    const bucketDelta = planningSortBucket(a) - planningSortBucket(b);
    if (bucketDelta) return bucketDelta;
    const timeDelta = planningSortTime(a) - planningSortTime(b);
    if (timeDelta) return timeDelta;
    return String((a.title || a.name || "")).localeCompare(String(b.title || b.name || ""));
  });
}

export function mergeDeadlineOverlayIntoEvents({ eventComputed, deadlineOverlayComputed }) {
  if (!deadlineOverlayComputed) return eventComputed;
  const itemsByDay = { ...(eventComputed.itemsByDay || {}) };
  const itemsByDate = { ...(eventComputed.itemsByDate || {}) };

  for (const [day, deadlines] of Object.entries(deadlineOverlayComputed.itemsByDay || {})) {
    itemsByDay[day] = orderPlanningItems([...(itemsByDay[day] || []), ...deadlines]);
  }

  for (const [dateKey, deadlines] of Object.entries(deadlineOverlayComputed.itemsByDate || {})) {
    itemsByDate[dateKey] = orderPlanningItems([...(itemsByDate[dateKey] || []), ...deadlines]);
  }

  return {
    ...eventComputed,
    itemsByDay,
    itemsByDate,
    deadlineOverlay: deadlineOverlayComputed,
    totalDeadlines: deadlineOverlayComputed.totalDeadlines || 0,
    activeDeadlines: deadlineOverlayComputed.activeDeadlines || 0,
    completedDeadlines: deadlineOverlayComputed.completedDeadlines || 0,
  };
}

export function deadlinePlanningDescriptor(task) {
  const accent = deadlinePlanningAccent(task);
  const status = normalizeStatus(task.status);
  return {
    id: getDeadlineSelectionId(task, task.agendaDateKey || task.due_date),
    sourceItem: task,
    itemKind: "deadline",
    detailView: "deadlines",
    title: deadlinePlanningTitle(task),
    detail: [deadlinePlanningSubtitle(task), statusLabel(status)].filter(Boolean).join(" · "),
    leadingLabel: deadlinePlanningTimeLabel(task),
    recurring: sourceOf(task) === "todoist" && !!task.is_recurring,
    accent,
    leadingColor: accent,
    complete: status === "complete",
    quiet: status === "complete",
    statusIcon: deadlinePlanningStatusIcon(status),
    statusLabel: statusLabel(status),
    sortMs: dueDateToMs(task.due_date, task.due_time) ?? Number.POSITIVE_INFINITY,
  };
}
