import { createClient } from "@libsql/client";
export async function createCompletedTasksTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS ea_completed_tasks (
      user_id TEXT NOT NULL,
      todoist_id TEXT NOT NULL,
      completed_at TEXT DEFAULT (datetime('now')),
      due_date TEXT,
      snapshot_json TEXT,
      PRIMARY KEY (user_id, todoist_id, due_date)
    );
  `);
  return db;
}

export async function seedCompletedTask(db, task = {}) {
  const row = {
    user_id: "user-1",
    todoist_id: "td-1",
    due_date: null,
    snapshot_json: null,
    ...task,
  };

  await db.execute({
    sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, due_date, snapshot_json)
          VALUES (?, ?, ?, ?)`,
    args: [row.user_id, row.todoist_id, row.due_date, row.snapshot_json],
  });

  return row;
}

export async function listCompletedTasks(db, userId = "user-1") {
  const result = await db.execute({
    sql: `SELECT user_id, todoist_id, due_date, snapshot_json
          FROM ea_completed_tasks
          WHERE user_id = ?
          ORDER BY todoist_id`,
    args: [userId],
  });
  return result.rows;
}
