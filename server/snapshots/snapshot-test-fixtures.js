// Shared Vitest fixtures for the snapshot module family
// (snapshot-service, snapshot-item-mutations, snapshot-triage-attachment,
// snapshot-snooze-lifecycle). Not a test file itself.

import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getOrCreateActiveSnapshot } from "./snapshot-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const migrationSql = readFileSync(
  join(__dirname, "../db/migrations/001_ea_tables.sql"),
  "utf8",
);

export async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(migrationSql);
  const migration018 = readFileSync(
    join(__dirname, "../db/migrations/018_carryover_depth_bound.sql"),
    "utf8",
  );
  await db.executeMultiple(migration018);
  // getActiveSnapshotView reads ea_pinned_emails (022) unconditionally, so every
  // caller of this shared fixture needs the table even if a given test never
  // pins anything.
  const migration022 = readFileSync(
    join(__dirname, "../db/migrations/022_pinned_emails.sql"),
    "utf8",
  );
  await db.executeMultiple(migration022);
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
