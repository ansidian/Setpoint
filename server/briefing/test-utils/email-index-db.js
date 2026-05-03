import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../db/migrations");

const migrationFiles = [
  "001_ea_tables.sql",
  "003_account_icon.sql",
  "010_account_sort_order.sql",
  "016_email_search_index.sql",
  "019_email_body_text.sql",
  "029_email_backfill_state.sql",
  "030_triage_snapshots.sql",
  "031_gmail_watch_state.sql",
];

const migrationSql = migrationFiles.map((file) =>
  readFileSync(join(migrationsDir, file), "utf8"),
);

export async function createEmailIndexTestDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function seedEmailAccount(db, account = {}) {
  const row = {
    id: "gmail-work",
    user_id: "user-1",
    type: "gmail",
    email: "work@example.com",
    label: "Work",
    color: "#123456",
    sort_order: 0,
    credentials_encrypted: null,
    ...account,
  };
  await db.execute({
    sql: `INSERT INTO ea_accounts
            (id, user_id, type, email, label, color, credentials_encrypted, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.user_id,
      row.type,
      row.email,
      row.label,
      row.color,
      row.credentials_encrypted,
      row.sort_order,
    ],
  });
  return row;
}

export async function seedIndexedEmail(db, email = {}) {
  const row = {
    uid: "gmail-work-msg-1",
    user_id: "user-1",
    account_id: "gmail-work",
    account_label: "Work",
    account_email: "work@example.com",
    account_color: "#123456",
    account_icon: "Mail",
    from_name: "Sender",
    from_address: "sender@example.com",
    subject: "Tuition receipt",
    body_snippet: "Historical indexed receipt",
    body_text: "Historical indexed receipt",
    email_date: "2026-05-01T12:00:00Z",
    read: 1,
    ...email,
  };
  await db.batch([
    {
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               account_color, account_icon, from_name, from_address,
               subject, body_snippet, body_text, email_date, read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.uid,
        row.user_id,
        row.account_id,
        row.account_label,
        row.account_email,
        row.account_color,
        row.account_icon,
        row.from_name,
        row.from_address,
        row.subject,
        row.body_snippet,
        row.body_text,
        row.email_date,
        row.read,
      ],
    },
    {
      sql: `INSERT INTO ea_email_fts
              (uid, from_name, from_address, subject, body_snippet, body_text)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        row.uid,
        row.from_name,
        row.from_address,
        row.subject,
        row.body_snippet,
        row.body_text,
      ],
    },
  ]);
  return row;
}
