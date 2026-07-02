// Shared Vitest fixtures for the snapshot module family
// (snapshot-service, snapshot-item-mutations, snapshot-triage-attachment,
// snapshot-snooze-lifecycle). Not a test file itself.

import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getOrCreateActiveSnapshot } from "./snapshot-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");
export const migrationSql = readFileSync(
  join(migrationsDir, "001_ea_tables.sql"),
  "utf8",
);

// Every real migration file in boot order — the same set migrate() applies to a
// fresh database. Applying them all means schema-dependent reads (e.g.
// getActiveSnapshotView's unconditional ea_pinned_emails read) never need
// hand-copied DDL in per-test setups when a new migration lands.
const allMigrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"));

export async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of allMigrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function seedSnapshotItem(dbClient, {
  userId = "user-1",
  accountId = "gmail-work",
  emailId = "msg-1",
  lane = "needs_attention",
  category = "school",
  now = new Date("2026-05-03T15:00:00.000Z"),
} = {}) {
  const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now });
  const triageResult = await dbClient.execute({
    sql: `INSERT INTO ea_email_triage
            (user_id, account_id, email_id, lane, category, triage_status)
          VALUES (?, ?, ?, ?, ?, 'complete')
          RETURNING id`,
    args: [userId, accountId, emailId, lane, category],
  });
  const triageId = Number(triageResult.rows[0].id);
  const itemResult = await dbClient.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, category_at_snapshot, subject_at_snapshot)
          VALUES (?, ?, ?, ?, ?, ?, 'Summary', 'Review', 'normal', ?, 'Subject')
          RETURNING id`,
    args: [snapshot.id, triageId, userId, accountId, emailId, lane, category],
  });
  return {
    snapshot,
    triageId,
    itemId: Number(itemResult.rows[0].id),
  };
}
