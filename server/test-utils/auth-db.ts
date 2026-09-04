import { createClient, type Client } from "@libsql/client";
import crypto from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createTestTempDir, removeTempDirSync } from "./temp-dir.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

const migrationFiles = [
  "001_ea_tables.sql",
  "012_passkey_auth.sql",
  "028_provider_needs_reauth.sql",
  "030_owner_bootstrap.sql",
  "031_auth_recovery.sql",
  "032_canonical_url.sql",
  "033_instance_credentials.sql",
  "034_google_oauth_binding.sql",
  "038_auth_security_generation.sql",
  "039_password_step_up_window.sql",
  "060_revoke_legacy_sessions.sql",
];

const migrationSql = migrationFiles.map((file) =>
  readFileSync(join(migrationsDir, file), "utf8"),
);

export type GmailAccountSeed = {
  id: string;
  user_id: string;
  type: string;
  email: string;
  label: string;
  color: string;
  credentials_encrypted: string | null;
  sort_order: number;
};

export function hashSessionToken(raw: string) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

export function hashApiToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createAuthTestDb() {
  const tempDir = await createTestTempDir("auth-db-");
  const db = createClient({ url: `file:${join(tempDir, "auth.db")}` });
  const close = db.close.bind(db);
  db.close = () => {
    close();
    removeTempDirSync(tempDir);
  };
  for (const sql of migrationSql) {
    await db.executeMultiple(sql);
  }
  return db;
}

export async function seedSession(
  db: Client,
  token = "cookie-session",
  expiresAt = Date.now() + 60_000,
  authenticatedAt = 0,
  {
    securityGeneration = 1,
    authMethod = authenticatedAt > 0 ? "password" : "legacy",
    passwordAuthenticatedAt = authenticatedAt,
  }: {
    securityGeneration?: number;
    authMethod?: "legacy" | "password" | "passkey" | "password_plus_passkey" | "recovery";
    passwordAuthenticatedAt?: number;
  } = {},
) {
  await db.execute({
    sql: `INSERT INTO ea_sessions
            (token, expires_at, authenticated_at, password_authenticated_at,
             security_generation, auth_method)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      hashSessionToken(token),
      expiresAt,
      authenticatedAt,
      passwordAuthenticatedAt,
      securityGeneration,
      authMethod,
    ],
  });
}

export async function seedOwner(
  db: Client,
  {
    userId = "user-1",
    passwordHash,
    claimedAt = Date.now(),
  }: { userId?: string; passwordHash: string; claimedAt?: number },
) {
  await db.execute({
    sql: `INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
          VALUES (1, ?, ?, ?)`,
    args: [userId, passwordHash, claimedAt],
  });
}

export async function seedGmailAccount(
  db: Client,
  account: Partial<GmailAccountSeed> = {},
) {
  const row: GmailAccountSeed = {
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
