import {
  fetchTodoistDueTaskIdSet,
  fetchTodoistTasks,
  fetchTodoistTasksAll,
  fetchTodoistTasksRange,
  getTodoistSyncHealth,
} from "./todoist.js";
import {
  computeDeadlineStats,
  filterCompletedTodoistTasks,
  loadCompletedTaskIds,
} from "./deadline-helpers.js";
import { hydrateTodoistTasksWithReminderState } from "./reminder-hydration.js";
import { hydrateRecurringTombstones } from "./tombstones.js";

function unavailableTodoistHealth(err) {
  return {
    state: "unavailable",
    configured: null,
    lastSuccessAt: null,
    lastError: err?.message || "Todoist sync health unavailable",
    syncStartedAt: null,
    ageMs: null,
  };
}

function quietSourceError(source, err) {
  return { source, message: err?.message || `${source} unavailable` };
}

function publicDeadlineItem(task) {
  if (!task || typeof task !== "object") return task;
  const { source: _source, ...item } = task;
  return item;
}

function deadlinePayload({ todoistTasks, todoistSyncHealth = null }) {
  const upcoming = (todoistTasks || []).map(publicDeadlineItem);
  const payload = {
    upcoming,
    stats: computeDeadlineStats(upcoming),
  };
  if (todoistSyncHealth) payload.syncHealth = todoistSyncHealth;
  return payload;
}

function todoistOccurrenceKey(task) {
  return `${task?.id || ""}:${task?.due_date || ""}`;
}

function mergeTodoistRowsWithTombstones(todoistTasks, tombstones) {
  const merged = [...(todoistTasks || [])];
  const seen = new Set(merged.map(todoistOccurrenceKey));
  for (const tombstone of tombstones || []) {
    const key = todoistOccurrenceKey(tombstone);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tombstone);
  }
  return merged;
}

export async function readCurrentDeadlines(userId, {
  force = false,
} = {}) {
  const [todoistTasks, todoistDueTaskIds] = await Promise.all([
    fetchTodoistTasks(userId, { refresh: !!force }).catch((err) => {
      console.error("[Dashboard] Todoist current refresh failed:", err.message);
      return [];
    }),
    fetchTodoistDueTaskIdSet(userId, { refresh: !!force }).catch((err) => {
      console.error("[Dashboard] Todoist id-set current refresh failed:", err.message);
      return null;
    }),
  ]);

  const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
  const activeTodoistTasks = filterCompletedTodoistTasks(todoistTasks, completedIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "today",
  });
  const todoistWithCompleted = mergeTodoistRowsWithTombstones(activeTodoistTasks, tombstones);

  return deadlinePayload({
    todoistTasks: todoistWithCompleted,
  });
}

export async function readCalendarDeadlines(userId) {
  const [todoistTasks, todoistDueTaskIds, todoistSyncHealth] = await Promise.all([
    fetchTodoistTasksAll(userId).catch((err) => {
      console.error("[Calendar] Todoist fetch failed:", err.message);
      return [];
    }),
    fetchTodoistDueTaskIdSet(userId).catch((err) => {
      console.error("[Calendar] Todoist id-set fetch failed:", err.message);
      return null;
    }),
    getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err)),
  ]);

  const completedIds = await loadCompletedTaskIds(userId, todoistTasks);
  const activeTodoistTasks = filterCompletedTodoistTasks(todoistTasks, completedIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "today",
  });
  const todoistWithCompleted = await hydrateTodoistTasksWithReminderState(userId, [
    ...mergeTodoistRowsWithTombstones(activeTodoistTasks, tombstones),
  ]);

  return deadlinePayload({
    todoistTasks: todoistWithCompleted,
    todoistSyncHealth,
  });
}

export async function readCalendarDeadlineRange(userId, range) {
  const errors = [];
  const [todoistResult, todoistDueTaskIdsResult, todoistHealthResult] = await Promise.allSettled([
    fetchTodoistTasksRange(userId, { start: range.start, end: range.end }),
    fetchTodoistDueTaskIdSet(userId),
    getTodoistSyncHealth(userId),
  ]);
  const todoistTasks = todoistResult.status === "fulfilled" ? todoistResult.value : [];
  const todoistSyncHealth = todoistHealthResult.status === "fulfilled"
    ? todoistHealthResult.value
    : unavailableTodoistHealth(todoistHealthResult.reason);
  const todoistDueTaskIds = todoistDueTaskIdsResult.status === "fulfilled"
    ? todoistDueTaskIdsResult.value
    : null;
  if (todoistResult.status === "rejected") errors.push(quietSourceError("todoist", todoistResult.reason));
  if (todoistDueTaskIdsResult.status === "rejected") errors.push(quietSourceError("todoist", todoistDueTaskIdsResult.reason));

  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    start: range.start,
    end: range.end,
  }).catch((err) => {
    errors.push(quietSourceError("todoist", err));
    return [];
  });
  const rangeTombstones = tombstones.filter((task) =>
    task.due_date && task.due_date >= range.start && task.due_date <= range.end,
  );
  const hydratedTodoist = await hydrateTodoistTasksWithReminderState(
    userId,
    mergeTodoistRowsWithTombstones(todoistTasks, rangeTombstones),
  );

  return {
    payload: deadlinePayload({
      todoistTasks: hydratedTodoist,
      todoistSyncHealth,
    }),
    errors,
  };
}
