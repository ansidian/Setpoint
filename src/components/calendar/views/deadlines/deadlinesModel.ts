import { parseDueDate, toPacificDate, todayPacific } from "../../../../lib/dashboard-helpers";
import { dueDateToMs } from "../../../../lib/shell-helpers";
import { isDemoMode } from "../../../../demo/config.ts";
import { parseYmd } from "../../calendarDateUtils.ts";
import { TODOIST_DEADLINE_COLOR } from "../../../../../shared/deadline-source-colors";
import type { CalendarItemLike } from "../calendarViewTypes";

export interface DeadlineItem extends CalendarItemLike {
  id?: string;
  title?: string | null;
  name?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  date?: string | null;
  due_time?: string | null;
  status?: string | null;
  source?: string | null;
  sourceColor?: string | null;
  color?: string | null;
  agendaDateKey?: string | null;
  agendaItemId?: string | null;
  _overdueHint?: boolean;
  _completing?: boolean;
  priority?: number | null;
  points_possible?: number | null;
  url?: string | null;
  labels?: string[];
}

export interface DeadlineDayState {
  items: DeadlineItem[];
  activeItems: DeadlineItem[];
  completedItems: DeadlineItem[];
  activeCount: number;
  completedCount: number;
  totalCount: number;
}

export interface DeadlinesData {
  upcoming?: DeadlineItem[];
  minDate?: string | null;
  stats?: Record<string, number>;
}

export interface DeadlinesComputed {
  itemsByDay: Record<string, DeadlineDayState>;
  itemsByDate: Record<string, DeadlineDayState>;
  earliestOverdue: Date | null;
}

export const MAX_PILLS = 2;

export const DEADLINE_COLOR = TODOIST_DEADLINE_COLOR;

export const PRIORITY_META = {
  1: { color: "#f38ba8", label: "P1 · Urgent" },
  2: { color: "#f9e2af", label: "P2 · High" },
  3: { color: "#89b4fa", label: "P3 · Medium" },
};

export function sourceOf(task?: unknown): string {
  return (task as DeadlineItem | null | undefined)?.source || "deadline";
}

export function deadlineAccentFor(task?: unknown, fallback = DEADLINE_COLOR): string {
  const deadline = task as DeadlineItem | null | undefined;
  return deadline?.color || deadline?.sourceColor || fallback || DEADLINE_COLOR;
}

export function normalizeStatus(status?: unknown): string {
  if (status === "open") return "incomplete";
  return typeof status === "string" && status ? status : "incomplete";
}

export function statusLabel(status?: unknown): string {
  const normalized = normalizeStatus(status);
  if (normalized === "complete") return "Complete";
  if (normalized === "in_progress") return "In progress";
  return "Incomplete";
}

export function openInNewTab(url?: string | null): void {
  if (!url) return;
  if (isDemoMode()) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function formatFullDate(year: number, month: number, day?: number | null, selectedDateKey?: string | null): string {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) {
    const d = new Date(parsed.year, parsed.month, parsed.day);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  if (day == null) return "Selected deadline";
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function deadlineItemsFromData(data?: DeadlinesData | null): DeadlineItem[] {
  if (Array.isArray(data?.upcoming)) return data.upcoming;
  return [];
}

export function getDeadlineOccurrenceDate(task?: unknown, dateKey: string | null = null): string {
  const deadline = task as DeadlineItem | null | undefined;
  return dateKey || deadline?.agendaDateKey || deadline?.due_date || deadline?.dueDate || deadline?.date || "undated";
}

export function getDeadlineSelectionId(task?: unknown, dateKey: string | null = null): string | null {
  const deadline = task as DeadlineItem | null | undefined;
  if (!deadline || deadline.id == null) return null;
  if (String(deadline.agendaItemId || "").startsWith("deadline:")) return String(deadline.agendaItemId);
  const occurrenceDateKey = getDeadlineOccurrenceDate(deadline, dateKey);
  return `deadline:${deadline.id}:${occurrenceDateKey}`;
}

export function deadlineMatchesItemId(task: unknown, itemId: unknown, dateKey: string | null = null): boolean {
  if (!task || itemId == null) return false;
  const deadline = task as DeadlineItem;
  const target = String(itemId);
  const occurrenceDateKey = getDeadlineOccurrenceDate(deadline, dateKey);
  const legacySource = sourceOf(deadline);
  const legacyIds = [
    `${legacySource}:${deadline.id}-${occurrenceDateKey}`,
    `${legacySource}:${deadline.id}`,
  ];
  return String(getDeadlineSelectionId(deadline, dateKey)) === target
    || String(deadline.agendaItemId || "") === target
    || String(deadline.id) === target
    || legacyIds.includes(target);
}

export function orderDeadlines(items: DeadlineItem[] = []): DeadlineItem[] {
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

export function groupDeadlines(items: DeadlineItem[] = []): DeadlineDayState {
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

export function getDayState(rawItems: unknown): DeadlineDayState {
  if (rawItems && typeof rawItems === "object" && "activeItems" in rawItems) return rawItems as DeadlineDayState;
  return groupDeadlines(Array.isArray(rawItems) ? rawItems as DeadlineItem[] : []);
}

export function getDefaultSelectedItemId(items: unknown = []): string {
  const state = getDayState(items);
  const firstOpen = state.activeItems[0];
  const fallback = firstOpen || state.completedItems[0];
  return getDeadlineSelectionId(fallback) || "";
}

export function compute({ data, viewYear, viewMonth }: { data?: DeadlinesData | null; viewYear: number; viewMonth: number }): DeadlinesComputed {
  const all = deadlineItemsFromData(data);

  const todayYmd = todayPacific();

  const rawItemsByDay: Record<string, DeadlineItem[]> = {};
  const rawItemsByDate: Record<string, DeadlineItem[]> = {};
  let earliestOverdue: Date | null = null;
  for (const task of all) {
    if (!task.due_date) continue;
    const dueDate = parseDueDate(task.due_date);
    if (Number.isNaN(dueDate.getTime())) continue;

    if (normalizeStatus(task.status) !== "complete" && toPacificDate(task.due_date) < todayYmd) {
      if (!earliestOverdue || dueDate < earliestOverdue) earliestOverdue = dueDate;
    }

    const day = dueDate.getDate();
    if (!rawItemsByDate[task.due_date]) rawItemsByDate[task.due_date] = [];
    rawItemsByDate[task.due_date]!.push(task);
    if (dueDate.getFullYear() !== viewYear || dueDate.getMonth() !== viewMonth) continue;
    if (!rawItemsByDay[day]) rawItemsByDay[day] = [];
    rawItemsByDay[day]!.push(task);
  }

  const itemsByDay: Record<string, DeadlineDayState> = {};
  const itemsByDate: Record<string, DeadlineDayState> = {};
  for (const day of Object.keys(rawItemsByDay)) {
    itemsByDay[day] = groupDeadlines(rawItemsByDay[day]);
  }
  for (const dateKey of Object.keys(rawItemsByDate)) {
    itemsByDate[dateKey] = groupDeadlines(rawItemsByDate[dateKey]);
  }

  return { itemsByDay, itemsByDate, earliestOverdue };
}

export function canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data, computed }: {
  viewYear: number;
  viewMonth: number;
  currentYear: number;
  currentMonth: number;
  data?: DeadlinesData | null;
  computed?: Partial<DeadlinesComputed> | null;
}): boolean {
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

export function hasOverdue(items: unknown): boolean {
  const state = getDayState(items);
  return state.activeItems.some((task) => task._overdueHint);
}

export function allComplete(_items: unknown): boolean {
  return false;
}
