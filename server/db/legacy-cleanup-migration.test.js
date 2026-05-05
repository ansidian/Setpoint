import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");
const cleanupMigration = "044_legacy_briefing_cleanup.sql";

async function applyMigrationsThrough(db, lastFile) {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && file <= lastFile)
    .sort();

  for (const file of files) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

async function tableExists(db, tableName) {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [tableName],
  });
  return result.rows.length > 0;
}

async function indexExists(db, indexName) {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    args: [indexName],
  });
  return result.rows.length > 0;
}

async function columnExists(db, tableName, columnName) {
  const result = await db.execute(`PRAGMA table_info(${tableName})`);
  return result.rows.some((row) => row.name === columnName);
}

describe("legacy briefing cleanup migration", () => {
  it("removes only legacy briefing artifacts and preserves current operational data", async () => {
    const db = createClient({ url: "file::memory:" });
    await applyMigrationsThrough(db, "043_email_triage_decision_metadata.sql");

    await db.execute({
      sql: `INSERT INTO ea_settings
              (user_id, claude_model, email_ai_provider, email_ai_model)
            VALUES (?, ?, ?, ?)`,
      args: ["user-1", "gpt-5.5", "openai", null],
    });
    const briefing = await db.execute({
      sql: `INSERT INTO ea_briefings
              (user_id, status, briefing_json)
            VALUES (?, 'ready', ?) RETURNING id`,
      args: ["user-1", JSON.stringify({ legacy: true })],
    });
    await db.execute({
      sql: `INSERT INTO ea_embeddings
              (user_id, briefing_id, section_type, chunk_text, source_date)
            VALUES (?, ?, 'email', 'legacy chunk', '2026-05-05')`,
      args: ["user-1", briefing.rows[0].id],
    });
    await db.execute({
      sql: "INSERT INTO ea_pinned_emails (user_id, email_id) VALUES (?, ?)",
      args: ["user-1", "legacy-email"],
    });
    await db.execute({
      sql: "INSERT INTO ea_completed_tasks (user_id, todoist_id, due_date, snapshot_json) VALUES (?, ?, NULL, NULL)",
      args: ["user-1", "legacy-completed"],
    });
    await db.execute({
      sql: `INSERT INTO ea_completed_tasks
              (user_id, todoist_id, due_date, snapshot_json)
            VALUES (?, ?, ?, ?)`,
      args: ["user-1", "due-tombstone", "2026-05-06", JSON.stringify({ content: "Keep me" })],
    });
    await db.execute({
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["user-1", "weather", "{}", "2026-05-05T12:00:00.000Z", "2026-05-05T13:00:00.000Z"],
    });
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, summary, action, decision_metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["user-1", "gmail-work", "email-1", "Current summary", "Reply", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["user-1", "gmail-work", "email-1", "classify", "job-1"],
    });
    await db.execute({
      sql: `INSERT INTO ea_briefing_snapshots
              (user_id, start_at, end_at, schedule_label)
            VALUES (?, ?, ?, ?)`,
      args: ["user-1", "2026-05-05T00:00:00.000Z", "2026-05-06T00:00:00.000Z", "Morning"],
    });

    await db.executeMultiple(readFileSync(join(migrationsDir, cleanupMigration), "utf8"));

    expect(await tableExists(db, "ea_embeddings")).toBe(false);
    expect(await tableExists(db, "ea_pinned_emails")).toBe(false);
    expect(await tableExists(db, "ea_briefings")).toBe(false);
    expect(await indexExists(db, "idx_ea_briefings_user_status")).toBe(false);
    expect(await columnExists(db, "ea_settings", "claude_model")).toBe(false);

    const settings = await db.execute("SELECT email_ai_provider, email_ai_model FROM ea_settings WHERE user_id = 'user-1'");
    expect(settings.rows).toEqual([{ email_ai_provider: "openai", email_ai_model: "gpt-5.5" }]);

    const completedTasks = await db.execute("SELECT todoist_id, due_date FROM ea_completed_tasks ORDER BY todoist_id");
    expect(completedTasks.rows).toEqual([{ todoist_id: "due-tombstone", due_date: "2026-05-06" }]);
    expect(await tableExists(db, "ea_completed_tasks")).toBe(true);

    const currentCache = await db.execute("SELECT cache_key FROM ea_current_data_cache WHERE user_id = 'user-1'");
    expect(currentCache.rows).toEqual([{ cache_key: "weather" }]);
    const triage = await db.execute("SELECT email_id FROM ea_email_triage WHERE user_id = 'user-1'");
    expect(triage.rows).toEqual([{ email_id: "email-1" }]);
    const jobs = await db.execute("SELECT idempotency_key FROM ea_triage_jobs WHERE user_id = 'user-1'");
    expect(jobs.rows).toEqual([{ idempotency_key: "job-1" }]);
    const snapshots = await db.execute("SELECT schedule_label FROM ea_briefing_snapshots WHERE user_id = 'user-1'");
    expect(snapshots.rows).toEqual([{ schedule_label: "Morning" }]);
  });
});
