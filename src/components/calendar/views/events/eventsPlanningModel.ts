import {
  DEADLINE_COLOR,
  deadlineAccentFor,
  deadlineMatchesItemId,
  getDayState,
  getDeadlineSelectionId,
  getDeadlineOccurrenceDate,
  normalizeStatus,
  statusLabel,
  compute as computeDeadlines,
} from "../deadlines/deadlinesModel.ts";
import { dueDateToMs, getEventSelectionId } from "../../../../lib/shell-helpers";
import type { CalendarItemLike, CalendarComputed } from "../calendarViewTypes";

export type PlanningItem = CalendarItemLike;
interface DeadlineDayState {
  items: PlanningItem[];
  activeItems: PlanningItem[];
  completedItems: PlanningItem[];
  activeCount: number;
  completedCount: number;
}
interface DeadlineComputed {
  itemsByDay: Record<number, PlanningItem[] | DeadlineDayState>;
  itemsByDate: Record<string, PlanningItem[] | DeadlineDayState>;
  [key: string]: unknown;
}
export interface DeadlineOverlayComputed extends CalendarComputed<PlanningItem> {
  itemsByDay: Record<string, PlanningItem[]>;
  itemsByDate: Record<string, PlanningItem[]>;
  totalDeadlines: number;
  activeDeadlines: number;
  completedDeadlines: number;
}

const readDeadlineDayState = getDayState as unknown as (items: unknown) => DeadlineDayState;
const computeDeadlineView = computeDeadlines as unknown as (input: {
  data: unknown;
  viewYear: number;
  viewMonth: number;
}) => DeadlineComputed;
const eventSelectionId = getEventSelectionId as unknown as (item: PlanningItem | null | undefined) => string | null;
const deadlineSelectionId = getDeadlineSelectionId as unknown as (item: PlanningItem, dateKey?: string | null) => string | null;
const matchesDeadlineId = deadlineMatchesItemId as unknown as (item: PlanningItem, itemId: unknown, dateKey?: string | null) => boolean;
const deadlineAccent = deadlineAccentFor as unknown as (item: PlanningItem, fallback?: string) => string;
const deadlineOccurrenceDate = getDeadlineOccurrenceDate as unknown as (item: PlanningItem, dateKey?: string | null) => string;

export function isDeadlinePlanningItem(item: unknown): boolean {
  const planningItem = item as PlanningItem | null | undefined;
  return planningItem?.calendarItemKind === "deadline" || (!!planningItem?.due_date && !planningItem?.startMs);
}

export function getPlanningItemId(item: unknown): string | null {
  const planningItem = item as PlanningItem;
  if (isDeadlinePlanningItem(planningItem)) return deadlineSelectionId(planningItem, planningItem.agendaDateKey || planningItem.due_date);
  return eventSelectionId(planningItem);
}

export function matchesPlanningItemId(item: unknown, itemId: unknown): boolean {
  const planningItem = item as PlanningItem;
  if (itemId == null) return false;
  if (isDeadlinePlanningItem(planningItem)) {
    return matchesDeadlineId(planningItem, itemId, planningItem.agendaDateKey || planningItem.due_date);
  }
  return String(eventSelectionId(planningItem)) === String(itemId)
    || String(planningItem?.id) === String(itemId);
}

export function deadlinePlanningAccent(task: PlanningItem): string {
  return deadlineAccent(task, DEADLINE_COLOR);
}

export function deadlinePlanningTitle(task: PlanningItem): string {
  return task?.title || task?.name || "Untitled";
}

export function deadlinePlanningSubtitle(task: PlanningItem): string {
  return task?.project_name || task?.class_name || "Deadline";
}

export function deadlinePlanningTimeLabel(task: PlanningItem): string {
  return task?.due_time || "Deadline";
}

export function deadlinePlanningStatusIcon(status: unknown): "complete" | "in_progress" | null {
  if (status === "complete") return "complete";
  if (status === "in_progress") return "in_progress";
  return null;
}

function cloneDeadlineForDate(task: PlanningItem, dateKey: string): PlanningItem {
  return {
    ...task,
    calendarItemKind: "deadline",
    agendaDateKey: dateKey,
    agendaItemId: deadlineSelectionId(task, dateKey),
  };
}

function filteredDeadlineItems(rawItems: unknown, showCompleted: boolean): PlanningItem[] {
  const state = readDeadlineDayState(rawItems);
  return (showCompleted ? state.items : state.activeItems).map((task) => (
    cloneDeadlineForDate(task, task.agendaDateKey || task.due_date || "undated")
  ));
}

export function getDeadlineOverlayComputed({ deadlineData, viewYear, viewMonth, showCompleted = true }: {
  deadlineData?: unknown;
  viewYear: number;
  viewMonth: number;
  showCompleted?: boolean;
}): DeadlineOverlayComputed | null {
  if (!deadlineData) return null;
  const computed = computeDeadlineView({ data: deadlineData, viewYear, viewMonth });
  const itemsByDay: Record<string, PlanningItem[]> = {};
  const itemsByDate: Record<string, PlanningItem[]> = {};
  let totalDeadlines = 0;
  let activeDeadlines = 0;
  let completedDeadlines = 0;

  for (const [day, rawItems] of Object.entries(computed.itemsByDay || {})) {
    const state = readDeadlineDayState(rawItems);
    const items = filteredDeadlineItems(rawItems, showCompleted);
    if (items.length) itemsByDay[day] = items;
    totalDeadlines += items.length;
    activeDeadlines += state.activeCount || 0;
    completedDeadlines += showCompleted ? state.completedCount || 0 : 0;
  }

  for (const [dateKey, rawItems] of Object.entries(computed.itemsByDate || {})) {
    const items = filteredDeadlineItems(rawItems, showCompleted)
      .map((task) => ({ ...task, agendaDateKey: dateKey, agendaItemId: deadlineSelectionId(task, dateKey) }));
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

function planningSortBucket(item: PlanningItem): number {
  if (!isDeadlinePlanningItem(item)) return item?.allDay ? 0 : 1;
  const complete = normalizeStatus(item.status) === "complete";
  if (complete) return 4;
  const dueMs = dueDateToMs(item.due_date, item.due_time);
  const dayStart = dueDateToMs(item.agendaDateKey || item.due_date, null);
  if (dueMs != null && dayStart != null && Number.isFinite(dueMs) && Number.isFinite(dayStart) && dueMs <= dayStart + 86400000 - 1) return 2;
  return 3;
}

function planningSortTime(item: PlanningItem): number {
  if (isDeadlinePlanningItem(item)) {
    return dueDateToMs(item.due_date, item.due_time) ?? Number.POSITIVE_INFINITY;
  }
  return item?.startMs || 0;
}

export function orderPlanningItems<T extends PlanningItem>(items: T[] = []): T[] {
  return [...items].sort((a, b) => {
    const bucketDelta = planningSortBucket(a) - planningSortBucket(b);
    if (bucketDelta) return bucketDelta;
    const timeDelta = planningSortTime(a) - planningSortTime(b);
    if (timeDelta) return timeDelta;
    return String((a.title || a.name || "")).localeCompare(String(b.title || b.name || ""));
  });
}

export function mergeDeadlineOverlayIntoEvents<TItem extends PlanningItem, TComputed extends CalendarComputed<TItem>>({ eventComputed, deadlineOverlayComputed }: {
  eventComputed: TComputed;
  deadlineOverlayComputed: DeadlineOverlayComputed | null;
}): TComputed & { deadlineOverlay?: DeadlineOverlayComputed; totalDeadlines?: number; activeDeadlines?: number; completedDeadlines?: number } {
  if (!deadlineOverlayComputed) return eventComputed;
  const itemsByDay: Record<string, PlanningItem[]> = { ...(eventComputed.itemsByDay || {}) };
  const itemsByDate: Record<string, PlanningItem[]> = { ...(eventComputed.itemsByDate || {}) };

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
  } as TComputed & { deadlineOverlay: DeadlineOverlayComputed; totalDeadlines: number; activeDeadlines: number; completedDeadlines: number };
}

export function deadlinePlanningDescriptor(task: PlanningItem) {
  const accent = deadlinePlanningAccent(task);
  const status = normalizeStatus(task.status);
  const selectionId = deadlineSelectionId(task, task.agendaDateKey || task.due_date);
  const occurrenceDate = deadlineOccurrenceDate(task, task.agendaDateKey || task.due_date);
  const source = task?.source || "deadline";
  return {
    id: selectionId,
    sourceItem: task,
    itemKind: "deadline",
    detailKind: "deadline",
    matchItemIds: [
      task?.id,
      selectionId,
      `${source}:${task?.id}-${occurrenceDate}`,
      `${source}:${task?.id}`,
    ].filter((value) => value != null).map(String),
    title: deadlinePlanningTitle(task),
    detail: [deadlinePlanningSubtitle(task), statusLabel(status)].filter(Boolean).join(" · "),
    leadingLabel: deadlinePlanningTimeLabel(task),
    recurring: !!task.is_recurring,
    accent,
    leadingColor: accent,
    complete: status === "complete",
    quiet: status === "complete",
    statusIcon: deadlinePlanningStatusIcon(status),
    statusLabel: statusLabel(status),
    sortMs: dueDateToMs(task.due_date, task.due_time) ?? Number.POSITIVE_INFINITY,
    hasUpcomingReminder: !!task.hasUpcomingReminder,
    upcomingReminderCount: task.upcomingReminderCount || 0,
    nextReminderAt: task.nextReminderAt || null,
    reminderState: task.reminderState || null,
  };
}
