import db from "../db/connection.js";

export async function loadCompletedTaskIds(userId, todoistTasks) {
  const result = await db.execute({
    sql: "SELECT todoist_id FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NULL",
    args: [userId],
  });
  const completedIds = new Set(result.rows.map((row) => row.todoist_id));

  if (todoistTasks?.length && completedIds.size) {
    const reopened = todoistTasks.filter((task) => completedIds.has(task.id)).map((task) => task.id);
    if (reopened.length) {
      console.log(`[Briefing] Reconciling ${reopened.length} un-completed Todoist task(s)`);
      await db.execute({
        sql: `DELETE FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NULL AND todoist_id IN (${reopened.map(() => "?").join(",")})`,
        args: [userId, ...reopened],
      });
      for (const id of reopened) completedIds.delete(id);
    }
  }

  return completedIds;
}

export function separateDeadlines(ctmDeadlines, todoistTasks, completedIds) {
  const todoistIds = new Set(
    todoistTasks
      .filter((task) => task.id != null)
      .map((task) => String(task.id)),
  );
  const ctm = ctmDeadlines.filter(
    (deadline) => deadline.todoist_id == null || !todoistIds.has(String(deadline.todoist_id)),
  );

  let todoist = todoistTasks;

  if (completedIds?.size) {
    todoist = todoist.filter((task) => !completedIds.has(task.id) && !completedIds.has(String(task.id)));
  }

  return { ctm, todoist };
}

export function carryForwardCompletedTodoist(newList, prevList, boundary) {
  if (!prevList?.length) return newList;
  const keyOf = (task) => `${task.id}:${task.due_date}`;
  const keys = new Set(newList.map(keyOf));
  const carried = [];
  for (const task of prevList) {
    if (task.status !== "complete" || task._tombstone) continue;
    if (!task.due_date || task.due_date < boundary) continue;
    const key = keyOf(task);
    if (keys.has(key)) continue;
    carried.push(task);
    keys.add(key);
  }
  return carried.length ? [...newList, ...carried] : newList;
}

export function computeDeadlineStats(deadlines) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  const today = fmt.format(new Date());
  const weekFromNow = fmt.format(new Date(Date.now() + 7 * 86400000));
  let totalPoints = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let incomplete = 0;

  for (const deadline of deadlines) {
    if (deadline.status !== "complete") incomplete++;
    if (deadline.due_date === today) dueToday++;
    if (deadline.due_date >= today && deadline.due_date <= weekFromNow) dueThisWeek++;
    if (deadline.points_possible) totalPoints += deadline.points_possible;
  }

  return { incomplete, dueToday, dueThisWeek, totalPoints };
}
