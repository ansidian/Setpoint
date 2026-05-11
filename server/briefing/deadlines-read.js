import {
  fetchCTMDeadlines,
  fetchCTMDeadlinesAll,
  fetchCTMDeadlinesRange,
} from "./ctm.js";
import {
  fetchTodoistDueTaskIdSet,
  fetchTodoistTasks,
  fetchTodoistTasksAll,
  fetchTodoistTasksRange,
  getTodoistSyncHealth,
} from "./todoist.js";
import {
  computeDeadlineStats,
  loadCompletedTaskIds,
  separateDeadlines,
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

function deadlinePayload({ ctmDeadlines, todoistTasks, todoistSyncHealth = null }) {
  const payload = {
    ctm: {
      upcoming: ctmDeadlines,
      stats: computeDeadlineStats(ctmDeadlines),
    },
    todoist: {
      upcoming: todoistTasks,
      stats: computeDeadlineStats(todoistTasks),
    },
  };
  if (todoistSyncHealth) payload.todoist.syncHealth = todoistSyncHealth;
  return payload;
}

export async function readCurrentDeadlines(userId, {
  force = false,
} = {}) {
  const [ctmDeadlines, todoistTasks, todoistDueTaskIds] = await Promise.all([
    fetchCTMDeadlines().catch((err) => {
      console.error("[Dashboard] CTM current refresh failed:", err.message);
      return [];
    }),
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
  const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "today",
  });
  const todoistWithCompleted = [...separated.todoist, ...tombstones];

  return deadlinePayload({
    ctmDeadlines: separated.ctm,
    todoistTasks: todoistWithCompleted,
  });
}

export async function readCalendarDeadlines(userId) {
  const [ctmDeadlines, todoistTasks, todoistDueTaskIds, todoistSyncHealth] = await Promise.all([
    fetchCTMDeadlinesAll().catch((err) => {
      console.error("[Calendar] CTM fetch failed:", err.message);
      return [];
    }),
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
  const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "today",
  });
  const todoistWithCompleted = await hydrateTodoistTasksWithReminderState(userId, [
    ...separated.todoist,
    ...tombstones,
  ]);

  return deadlinePayload({
    ctmDeadlines: separated.ctm,
    todoistTasks: todoistWithCompleted,
    todoistSyncHealth,
  });
}

export async function readCalendarDeadlineRange(userId, range) {
  const errors = [];
  const [ctmResult, todoistResult, todoistDueTaskIdsResult, todoistHealthResult] = await Promise.allSettled([
    fetchCTMDeadlinesRange({ start: range.start, end: range.end }),
    fetchTodoistTasksRange(userId, { start: range.start, end: range.end }),
    fetchTodoistDueTaskIdSet(userId),
    getTodoistSyncHealth(userId),
  ]);
  const ctmDeadlines = ctmResult.status === "fulfilled" ? ctmResult.value : [];
  const todoistTasks = todoistResult.status === "fulfilled" ? todoistResult.value : [];
  const todoistSyncHealth = todoistHealthResult.status === "fulfilled"
    ? todoistHealthResult.value
    : unavailableTodoistHealth(todoistHealthResult.reason);
  const todoistDueTaskIds = todoistDueTaskIdsResult.status === "fulfilled"
    ? todoistDueTaskIdsResult.value
    : null;
  if (ctmResult.status === "rejected") errors.push(quietSourceError("ctm", ctmResult.reason));
  if (todoistResult.status === "rejected") errors.push(quietSourceError("todoist", todoistResult.reason));
  if (todoistDueTaskIdsResult.status === "rejected") errors.push(quietSourceError("todoist", todoistDueTaskIdsResult.reason));

  const tombstones = await hydrateRecurringTombstones(userId, todoistDueTaskIds, {
    viewBoundary: "yesterday",
  }).catch((err) => {
    errors.push(quietSourceError("todoist", err));
    return [];
  });
  const rangeTombstones = tombstones.filter((task) =>
    task.due_date && task.due_date >= range.start && task.due_date <= range.end,
  );
  const separated = separateDeadlines(ctmDeadlines, [...todoistTasks, ...rangeTombstones], new Set());
  const hydratedTodoist = await hydrateTodoistTasksWithReminderState(userId, separated.todoist);

  return {
    payload: deadlinePayload({
      ctmDeadlines: separated.ctm,
      todoistTasks: hydratedTodoist,
      todoistSyncHealth,
    }),
    errors,
  };
}
