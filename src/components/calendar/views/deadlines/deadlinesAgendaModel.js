import { buildDisplayedMonthGroups, sparseVisibleGroups } from "../agenda/agendaDateModel.js";
import {
  getDayState,
  normalizeStatus,
  SOURCE_COLORS,
  sourceLabelFor,
  sourceOf,
  statusLabel,
} from "./deadlinesModel.js";

function deadlineTitle(task) {
  return task.title || task.name || "Untitled task";
}

function deadlineSubtitle(task) {
  return task.project_name || task.class_name || sourceLabelFor(task);
}

function deadlineTimeLabel(task) {
  return task.due_time || "End of day";
}

function toAgendaDeadline(task, dateKey) {
  const source = sourceOf(task);
  const status = normalizeStatus(task.status);
  const sourceColor = SOURCE_COLORS[source] || "#89b4fa";
  return {
    ...task,
    agendaDateKey: dateKey,
    agendaItemId: String(task.id),
    agendaKey: `${source}:${task.id}-${dateKey}`,
    agendaTitle: deadlineTitle(task),
    agendaSubtitle: deadlineSubtitle(task),
    agendaMeta: deadlineTimeLabel(task),
    agendaStatus: statusLabel(status),
    agendaDotColor: sourceColor,
    agendaSelectedColor: sourceColor,
    agendaComplete: status === "complete",
    agendaSource: source,
  };
}

export function buildDeadlinesAgendaGroups({
  computed,
  viewYear,
  viewMonth,
  todayKey,
  forceVisibleDateKey = null,
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
    group.items = state.items.map((task) => toAgendaDeadline(task, dateKey));
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
