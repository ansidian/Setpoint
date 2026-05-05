import db from "../db/connection.js";
import {
  completeTodoistTask,
  deleteTodoistTask,
  fetchTodoistProjects,
  fetchTodoistLabels,
  fetchTodoistTasksAll,
  createTodoistTask,
  updateTodoistTask,
} from "./todoist.js";
import { fetchCTMDeadlinesAll, updateCTMEventStatus } from "./ctm.js";
import { buildSnapshot } from "./tombstones.js";

function findCtmTask(tasks, taskId) {
  return (tasks || []).find((task) =>
    String(task.id) === String(taskId) || String(task.todoist_id) === String(taskId),
  ) || null;
}

function findTodoistTask(tasks, taskId) {
  return (tasks || []).find((task) =>
    !task._tombstone && String(task.id) === String(taskId),
  ) || null;
}

async function loadCompletionSources(userId) {
  const [ctmTasks, todoistTasks] = await Promise.all([
    fetchCTMDeadlinesAll().catch((err) => {
      console.error("[Briefing] CTM task source fetch failed:", err.message);
      return [];
    }),
    fetchTodoistTasksAll(userId, { refresh: true }).catch((err) => {
      console.error("[Briefing] Todoist task source fetch failed:", err.message);
      return [];
    }),
  ]);
  return { ctmTasks, todoistTasks };
}

async function persistCompletedTodoistTask(userId, todoistId, task) {
  if (task?.due_date) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO ea_completed_tasks
            (user_id, todoist_id, completed_at, due_date, snapshot_json)
            VALUES (?, ?, datetime('now'), ?, ?)`,
      args: [userId, todoistId, task.due_date, JSON.stringify(buildSnapshot(task))],
    });
    return;
  }

  await db.execute({
    sql: "INSERT OR IGNORE INTO ea_completed_tasks (user_id, todoist_id) VALUES (?, ?)",
    args: [userId, todoistId],
  });
}

export async function completeTask(userId, taskId) {
  const { ctmTasks, todoistTasks } = await loadCompletionSources(userId);
  const ctmTask = findCtmTask(ctmTasks, taskId);
  const todoistTask = findTodoistTask(todoistTasks, taskId);

  const todoistId = ctmTask?.todoist_id || (todoistTask ? taskId : null);

  if (todoistId) {
    try {
      await completeTodoistTask(userId, todoistId);
    } catch (err) {
      const wrapped = new Error(`Todoist close failed: ${err.message}`);
      wrapped.status = 502;
      throw wrapped;
    }
    await persistCompletedTodoistTask(userId, todoistId, todoistTask);
  }

  if (ctmTask) {
    await updateCTMEventStatus(ctmTask.id, "complete").catch((err) =>
      console.error("[Briefing] CTM status update failed:", err.message),
    );
  }
}

export async function updateCTMStatus(userId, taskId, status) {
  if (!["incomplete", "in_progress", "complete"].includes(status)) {
    const err = new Error("Invalid status");
    err.status = 400;
    throw err;
  }

  await updateCTMEventStatus(Number(taskId), status);

  if (status === "complete") {
    const ctmTasks = await fetchCTMDeadlinesAll().catch((err) => {
      console.error("[Briefing] CTM task source fetch failed:", err.message);
      return [];
    });
    const ctmTask = findCtmTask(ctmTasks, taskId);
    if (ctmTask?.todoist_id) {
      await completeTodoistTask(userId, ctmTask.todoist_id).catch((err) =>
        console.error("[Briefing] Todoist completion failed:", err.message),
      );
      await persistCompletedTodoistTask(userId, ctmTask.todoist_id, null);
    }
  }
}

export async function dismissTombstone(userId, todoistId) {
  await db.execute({
    sql: "DELETE FROM ea_completed_tasks WHERE user_id = ? AND todoist_id = ? AND due_date IS NOT NULL",
    args: [userId, todoistId],
  });
}

export async function listProjects(userId) {
  return fetchTodoistProjects(userId);
}

export async function listLabels(userId) {
  return fetchTodoistLabels(userId);
}

export async function createTask(userId, body) {
  const task = await createTodoistTask(userId, body);
  return task;
}

export async function updateTask(userId, id, body) {
  const task = await updateTodoistTask(userId, id, body);
  return task;
}

export async function deleteTask(userId, id) {
  await deleteTodoistTask(userId, id);
}
