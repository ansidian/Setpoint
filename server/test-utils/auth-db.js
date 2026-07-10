import { createClient } from "@libsql/client";
import crypto from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

const migrationFiles = ["001_ea_tables.sql", "012_passkey_auth.sql", "028_provider_needs_reauth.sql"];

const migrationSql = migrationFiles.map((file) =>
  readFileSync(join(migrationsDir, file), "utf8"),
);

export function hashSessionToken(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

export function hashApiToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createAuthTestDb() {
  const db = createClient({ url: "file::memory:" });
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function seedSession(db, token = "cookie-session", expiresAt = Date.now() + 60_000) {
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken(token), expiresAt],
  });
}

export async function seedGmailAccount(db, account = {}) {
  const row = {
    id: "gmail-user@example.com",
    user_id: "user-1",
    type: "gmail",
    email: "user@example.com",
    label: "Gmail",
    color: "#818cf8",
    credentials_encrypted: null,
    sort_order: 0,
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
