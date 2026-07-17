import db from "../db/connection.ts";
import {
  completeTodoistTask,
  deleteTodoistTask,
  fetchTodoistProjects,
  fetchTodoistLabels,
  fetchTodoistTasksAll,
  createTodoistTask,
  updateTodoistTask,
} from "./todoist.js";
import {
  deleteSourceReminders,
  recomputeUnsentRemindersForSource,
} from "../reminders/reminder-service.js";
import { todoistReminderAnchorFromTask } from "./todoist-reminder-source.js";
import { buildSnapshot } from "./tombstones.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DEADLINE_FIELDS = ["content", "project_id", "label_ids"];

function serviceError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function findTodoistTask(tasks, taskId) {
  return (tasks || []).find((task) =>
    !task._tombstone && String(task.id) === String(taskId),
  ) || null;
}

async function loadCompletionSources(userId) {
  const todoistTasks = await fetchTodoistTasksAll(userId, { refresh: true }).catch((err) => {
    console.error("[Briefing] Todoist task source fetch failed:", err.message);
    return [];
  });
  return { todoistTasks };
}

async function completedDeadlineOccurrenceExists(userId, todoistId, occurrenceDate) {
  const result = await db.execute({
    sql: `SELECT 1
          FROM ea_completed_tasks
          WHERE user_id = ? AND todoist_id = ? AND due_date = ?
          LIMIT 1`,
    args: [userId, todoistId, occurrenceDate],
  });
  return result.rows.length > 0;
}

async function persistCompletedDeadlineOccurrence(userId, todoistId, task, occurrenceDate) {
  if (!occurrenceDate) return false;
  const result = await db.execute({
    // INSERT OR IGNORE makes this an atomic claim on (user, todoist, due_date):
    // only the first writer gets rowsAffected > 0, so it can gate the Todoist close.
    sql: `INSERT OR IGNORE INTO ea_completed_tasks
          (user_id, todoist_id, completed_at, due_date, snapshot_json)
          VALUES (?, ?, datetime('now'), ?, ?)`,
    args: [
      userId,
      todoistId,
      occurrenceDate,
      JSON.stringify(buildSnapshot({ ...task, due_date: occurrenceDate })),
    ],
  });
  return result.rowsAffected > 0;
}

async function syncTodoistReminderAnchor(userId, task) {
  const sourceItemId = String(task?.id || "");
  if (!sourceItemId) return;
  const anchor = todoistReminderAnchorFromTask(task);
  if (!anchor?.anchorAt) {
    await deleteSourceReminders({
      userId,
      sourceType: "todoist_task",
      sourceItemId,
      unsentOnly: true,
    });
    return;
  }
  await recomputeUnsentRemindersForSource({
    userId,
    sourceType: "todoist_task",
    sourceItemId,
    anchorKind: anchor.anchorKind,
    anchorAt: anchor.anchorAt,
  });
}

function assertIsoDate(value, message = "Deadline occurrence date must be YYYY-MM-DD") {
  if (!ISO_DATE_RE.test(String(value || ""))) {
    throw serviceError(message, 400);
  }
}

function assertDeadlineDomainPayload(body = {}) {
  const legacyField = LEGACY_DEADLINE_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (legacyField) {
    throw serviceError(`Use deadline-domain fields instead of ${legacyField}`, 400);
  }
}

function dueStringFromDeadlineBody(body = {}) {
  if (body.dueString !== undefined) return body.dueString || undefined;
  const date = body.dueDate || "";
  const time = body.dueTime || "";
  return [date, time].filter(Boolean).join(" ") || undefined;
}

function todoistPayloadFromDeadlineBody(body = {}, { partial = false } = {}) {
  assertDeadlineDomainPayload(body);
  const payload = {};
  if (body.title !== undefined) {
    payload.content = String(body.title || "").trim();
    // An explicitly-provided blank title is always invalid — even on a partial
    // update — so it can never silently blank the Todoist task content.
    if (!payload.content) throw serviceError("Deadline title is required", 400);
  } else if (!partial) {
    throw serviceError("Deadline title is required", 400);
  }
  if (body.description !== undefined) payload.description = body.description || "";
  if (body.projectId !== undefined) payload.project_id = body.projectId || null;
  if (body.labelIds !== undefined) payload.labels = Array.isArray(body.labelIds) ? body.labelIds : [];
  if (body.priority !== undefined) payload.priority = body.priority;
  const dueString = dueStringFromDeadlineBody(body);
  if (dueString !== undefined) payload.due_string = dueString;
  return payload;
}

export async function createDeadline(userId, body) {
  return createTodoistTask(userId, todoistPayloadFromDeadlineBody(body));
}

export async function updateDeadline(userId, deadlineId, body) {
  if (!deadlineId) throw serviceError("Deadline id is required", 400);
  const task = await updateTodoistTask(userId, deadlineId, todoistPayloadFromDeadlineBody(body, { partial: true }));
  await syncTodoistReminderAnchor(userId, task);
  return task;
}

export async function deleteDeadline(userId, deadlineId) {
  if (!deadlineId) throw serviceError("Deadline id is required", 400);
  await deleteTask(userId, deadlineId);
}

export async function completeDeadlineOccurrence(userId, deadlineId, occurrenceDate) {
  if (!deadlineId) throw serviceError("Deadline id is required", 400);
  assertIsoDate(occurrenceDate);
  if (await completedDeadlineOccurrenceExists(userId, deadlineId, occurrenceDate)) {
    return { completed: true, alreadyCompleted: true, deadlineId: String(deadlineId), occurrenceDate };
  }

  const { todoistTasks } = await loadCompletionSources(userId);
  const todoistTask = findTodoistTask(todoistTasks, deadlineId);
  if (!todoistTask) throw serviceError("Deadline not found", 404);

  if (todoistTask.due_date && todoistTask.due_date !== occurrenceDate) {
    throw serviceError("Deadline occurrence is not active for that date", 409);
  }
  if (todoistTask.status === "complete") {
    await persistCompletedDeadlineOccurrence(userId, deadlineId, todoistTask, occurrenceDate);
    return { completed: true, alreadyCompleted: true, deadlineId: String(deadlineId), occurrenceDate };
  }

  // Atomically claim the occurrence BEFORE closing the Todoist task: only the
  // request that wins the (user, todoist, due_date) INSERT OR IGNORE proceeds, so
  // concurrent completions can't double-close (and double-advance) a recurring task.
  const claimed = await persistCompletedDeadlineOccurrence(userId, deadlineId, todoistTask, occurrenceDate);
  if (!claimed) {
    return { completed: true, alreadyCompleted: true, deadlineId: String(deadlineId), occurrenceDate };
  }

  try {
    await completeTodoistTask(userId, deadlineId);
  } catch (err) {
    // Roll back the claim so a retry can re-attempt the close.
    await db.execute({
      sql: "DELETE FROM ea_completed_tasks WHERE user_id = ? AND todoist_id = ? AND due_date = ?",
      args: [userId, deadlineId, occurrenceDate],
    }).catch(() => {});
    const wrapped = new Error(`Todoist close failed: ${err.message}`);
    wrapped.status = 502;
    throw wrapped;
  }
  // The completion is recorded by the atomic claim ABOVE (INSERT OR IGNORE,
  // written BEFORE the /close) and that row is rolled back only if the /close
  // itself throws — so once /close succeeds the completion is already durably
  // recorded. The only remaining post-close work is best-effort reminder cleanup;
  // a failure here must be logged but must NOT surface as a failed completion.
  try {
    await deleteSourceReminders({
      userId,
      sourceType: "todoist_task",
      sourceItemId: String(deadlineId),
      unsentOnly: true,
    });
  } catch (err) {
    console.error("[Briefing] Reminder cleanup after Todoist close failed:", err.message);
  }
  return { completed: true, alreadyCompleted: false, deadlineId: String(deadlineId), occurrenceDate };
}

export async function listProjects(userId) {
  return fetchTodoistProjects(userId);
}

export async function listLabels(userId) {
  return fetchTodoistLabels(userId);
}

async function deleteTask(userId, id) {
  await deleteTodoistTask(userId, id);
  await deleteSourceReminders({
    userId,
    sourceType: "todoist_task",
    sourceItemId: String(id),
  });
}
