import { buildDisplayedMonthGroups, sparseVisibleGroups } from "../agenda/agendaDateModel.js";
import {
  DEADLINE_COLOR,
  deadlineAccentFor,
  getDayState,
  getDeadlineSelectionId,
  normalizeStatus,
  statusLabel,
} from "./deadlinesModel.js";

function deadlineTitle(task) {
  return task.title || task.name || "Untitled task";
}

function deadlineSubtitle(task) {
  return task.project_name || task.class_name || "Deadline";
}

function deadlineTimeLabel(task) {
  return task.due_time || "End of day";
}

function toAgendaDeadline(task, dateKey) {
  const status = normalizeStatus(task.status);
  const accent = deadlineAccentFor(task, DEADLINE_COLOR);
  const agendaItemId = getDeadlineSelectionId(task, dateKey);
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
} = {}) {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups({
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
