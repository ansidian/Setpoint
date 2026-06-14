import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"));

export async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function queueEmail(dbClient, email = {}) {
  const row = {
    uid: "msg-1",
    user_id: "user-1",
    account_id: "gmail-work",
    account_label: "Work",
    account_email: "work@example.com",
    from_name: "Example Deals",
    from_address: "deals@example.com",
    subject: "Weekend sale - 40% off",
    body_snippet: "Unsubscribe any time.",
    body_text: "Sale ends soon. Unsubscribe any time.",
    email_date: "2026-05-03T12:00:00.000Z",
    ...email,
  };
  await dbClient.batch([
    {
      sql: `INSERT INTO ea_settings (user_id, email_triage_mode)
            VALUES (?, 'real')
            ON CONFLICT(user_id) DO NOTHING`,
      args: [row.user_id],
    },
    {
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               account_color, account_icon, from_name, from_address,
               subject, body_snippet, body_text, email_date, read)
            VALUES (?, ?, ?, ?, ?, '#818cf8', 'Mail', ?, ?, ?, ?, ?, ?, 0)`,
      args: [
      row.uid,
      row.user_id,
      row.account_id,
      row.account_label,
      row.account_email,
      row.from_name,
      row.from_address,
      row.subject,
      row.body_snippet,
      row.body_text,
      row.email_date,
      ],
    },
    {
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id)
            VALUES (?, ?, ?)`,
      args: [row.user_id, row.account_id, row.uid],
    },
    {
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', ?)`,
      args: [
      row.user_id,
      row.account_id,
      row.uid,
      `email_triage:${row.user_id}:${row.account_id}:${row.uid}`,
      ],
    },
  ]);
  return row;
}
