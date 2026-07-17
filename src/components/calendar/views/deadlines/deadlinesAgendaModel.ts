import { buildDisplayedMonthGroups, sparseVisibleGroups } from "../agenda/agendaDateModel.ts";
import {
  DEADLINE_COLOR,
  deadlineAccentFor,
  getDayState,
  getDeadlineSelectionId,
  normalizeStatus,
  statusLabel,
} from "./deadlinesModel.ts";
import type { AgendaDateGroup } from "../agenda/agendaDateModel";
import type { DeadlineItem, DeadlinesComputed } from "./deadlinesModel";

export interface AgendaDeadlineItem extends DeadlineItem {
  agendaDateKey: string;
  agendaItemId: string;
  agendaKey: string;
  agendaTitle: string;
  agendaSubtitle: string;
  agendaMeta: string;
  agendaStatus: string;
  agendaDotColor: string;
  agendaSelectedColor: string;
  agendaComplete: boolean;
  agendaSource: string;
}

export interface DeadlinesAgendaGroup extends AgendaDateGroup {
  items: AgendaDeadlineItem[];
  hasDeadlines: boolean;
}

export interface DeadlinesAgendaResult {
  groups: DeadlinesAgendaGroup[];
  visibleGroups: DeadlinesAgendaGroup[];
  firstVisibleDateKey: string;
  monthStartDateKey: string;
}

export type DeadlinesAgendaMonthResult = DeadlinesAgendaResult & { monthKey: string; year: number; month: number };

function deadlineTitle(task: DeadlineItem): string {
  return task.title || task.name || "Untitled task";
}

function deadlineSubtitle(task: DeadlineItem): string {
  return task.project_name || task.class_name || "Deadline";
}

function deadlineTimeLabel(task: DeadlineItem): string {
  return task.due_time || "End of day";
}

export function toAgendaDeadline(task: DeadlineItem, dateKey: string): AgendaDeadlineItem {
  const status = normalizeStatus(task.status);
  const accent = deadlineAccentFor(task, DEADLINE_COLOR);
  const agendaItemId = getDeadlineSelectionId(task, dateKey) || String(task.id || `deadline:${dateKey}`);
  return {
    ...task,
    agendaDateKey: dateKey,
    agendaItemId,
    agendaKey: agendaItemId,
    agendaTitle: deadlineTitle(task),
    agendaSubtitle: deadlineSubtitle(task),
    agendaMeta: deadlineTimeLabel(task),
    agendaStatus: statusLabel(status),
    agendaDotColor: accent,
    agendaSelectedColor: accent,
    agendaComplete: status === "complete",
    agendaSource: "deadline",
  };
}

export function buildDeadlinesAgendaGroups({
  computed,
  viewYear,
  viewMonth,
  todayKey,
  forceVisibleDateKey = null,
  showCompleted = true,
}: {
  computed?: DeadlinesComputed | null;
  viewYear: number;
  viewMonth: number;
  todayKey: string;
  forceVisibleDateKey?: string | null;
  showCompleted?: boolean;
} = {} as { viewYear: number; viewMonth: number; todayKey: string }): DeadlinesAgendaResult {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups<DeadlinesAgendaGroup>({
    viewYear,
    viewMonth,
    todayKey,
    createGroup: () => ({
      items: [],
      hasDeadlines: false,
    }),
  });

  for (const [dateKey, rawItems] of Object.entries(computed?.itemsByDate || {})) {
    const group = groupMap.get(dateKey);
    if (!group) continue;
    const state = getDayState(rawItems);
    group.items = state.items
      .map((task) => toAgendaDeadline(task, dateKey))
      .filter((task) => showCompleted || !task.agendaComplete);
    group.hasDeadlines = group.items.length > 0;
    group.hasItems = group.hasDeadlines;
  }

  const { visibleGroups, firstVisibleDateKey } = sparseVisibleGroups({
    groups,
    monthStartDateKey,
    forceVisibleDateKey,
    hasVisibleItems: (group) => group.hasDeadlines,
  });

  return {
    groups,
    visibleGroups,
    firstVisibleDateKey,
    monthStartDateKey,
  };
}
