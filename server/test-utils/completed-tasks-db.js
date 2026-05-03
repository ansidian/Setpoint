import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

const migrationFiles = [
  "001_ea_tables.sql",
  "014_completed_tasks.sql",
  "025_completed_tasks_metadata.sql",
];

const migrationSql = migrationFiles.map((file) =>
  readFileSync(join(migrationsDir, file), "utf8"),
);

export async function createCompletedTasksTestDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function seedReadyBriefing(db, userId, briefingJson, generatedAt = "2026-04-18T12:00:00Z") {
  await db.execute({
    sql: `INSERT INTO ea_briefings (user_id, status, briefing_json, generated_at)
          VALUES (?, 'ready', ?, ?)`,
    args: [userId, JSON.stringify(briefingJson), generatedAt],
  });
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
