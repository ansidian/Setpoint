import { createClient } from "@libsql/client";
import type { Client, Value } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normalizeEmailDateUtc } from "../email-date.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../db/migrations");

// Core migration set every email-index bootstrap needs: a migration touching
// ea_email_index or its FTS table gets added HERE, once — hand-copied per-test
// lists are the class that broke four bootstraps when 025 landed. Bootstraps
// opt into extra tables via `extraMigrations`; the minimal subsets are
// deliberate (faster suites), not drift.
const CORE_MIGRATION_FILES = [
  "001_ea_tables.sql",
  "004_email_read_state_search_index.sql",
  "005_email_search_embeddings.sql",
  "013_email_index_normalized_date.sql",
  "025_email_thread_identity.sql",
];

const DEFAULT_EXTRA_MIGRATION_FILES = [
  "006_email_search_embedding_state.sql",
  "007_email_search_ai_usage.sql",
];

interface SeedEmailAccountRow {
  id: string;
  user_id: string;
  type: string;
  email: string;
  label: string;
  color: string;
  sort_order: number;
  credentials_encrypted: string | null;
  created_at?: Value;
  updated_at?: Value;
}

interface SeedIndexedEmailRow {
  uid: string;
  user_id: string;
  account_id: string;
  account_label: string;
  account_email: string;
  account_color: string;
  account_icon: string;
  from_name: string;
  from_address: string;
  subject: string;
  body_snippet: string;
  body_text: string;
  email_date: string;
  email_date_utc: string | null;
  read: number;
  thread_id: string | null;
  message_id: string | null;
}

const migrationSqlByFile = new Map<string, string>();

function migrationSql(file: string): string {
  let sql = migrationSqlByFile.get(file);
  if (sql === undefined) {
    sql = readFileSync(join(migrationsDir, file), "utf8");
    migrationSqlByFile.set(file, sql);
  }
  return sql;
}

export async function createEmailIndexTestDb({ extraMigrations = DEFAULT_EXTRA_MIGRATION_FILES }: { extraMigrations?: string[] } = {}): Promise<Client> {
  const db = createClient({ url: "file::memory:" });
  // Zero-padded filenames: lexicographic sort = numeric application order.
  for (const file of [...CORE_MIGRATION_FILES, ...extraMigrations].sort()) {
    await db.executeMultiple(migrationSql(file));
  }
  return db;
}

export async function seedEmailAccount(db: Client, account: Partial<SeedEmailAccountRow> = {}): Promise<SeedEmailAccountRow> {
  const row: SeedEmailAccountRow = {
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
  const columns = ["id", "user_id", "type", "email", "label", "color", "credentials_encrypted", "sort_order"];
  const args: Value[] = [
    row.id,
    row.user_id,
    row.type,
    row.email,
    row.label,
    row.color,
    row.credentials_encrypted,
    row.sort_order,
  ];
  if (account.created_at !== undefined) {
    columns.push("created_at");
    args.push(account.created_at);
  }
  if (account.updated_at !== undefined) {
    columns.push("updated_at");
    args.push(account.updated_at);
  }
  await db.execute({
    sql: `INSERT INTO ea_accounts
            (${columns.join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})`,
    args,
  });
  return row;
}

export async function seedIndexedEmail(db: Client, email: Partial<SeedIndexedEmailRow> = {}): Promise<SeedIndexedEmailRow> {
  const row: SeedIndexedEmailRow = {
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
    email_date_utc: null,
    read: 1,
    thread_id: null,
    message_id: null,
    ...email,
  };
  const emailDateUtc = row.email_date_utc ?? normalizeEmailDateUtc(row.email_date);
  await db.batch([
    {
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               account_color, account_icon, from_name, from_address,
               subject, body_snippet, body_text, email_date, email_date_utc, read,
               thread_id, message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        emailDateUtc,
        row.read,
        row.thread_id,
        row.message_id,
      ],
    },
    {
      sql: `INSERT INTO ea_email_fts
              (rowid, uid, from_name, from_address, subject, body_snippet, body_text)
            VALUES ((SELECT rowid FROM ea_email_index WHERE uid = ?), ?, ?, ?, ?, ?, ?)`,
      args: [
        row.uid,
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
