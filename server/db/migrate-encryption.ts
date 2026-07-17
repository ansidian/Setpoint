import db from "./connection.ts";
import { encrypt, decrypt } from "../platform/encryption.js";
import type { Row } from "@libsql/client";

// One-shot rewrite of CBC-encrypted column values into GCM format.
// `decrypt()` now REJECTS (throws on) non-GCM ciphertext (see
// ../platform/encryption.js) rather than decrypting it — so this migration can
// only succeed on rows that already round-trip through GCM. Any lingering CBC
// straggler makes rewriteColumn() throw for that row; the per-target
// try/catch below logs it and moves on without retrying. In practice this
// makes the migration inert unless a legacy CBC row resurfaces (e.g. restored
// from an old backup), in which case it surfaces via the logged error rather
// than rewriting the value.
type EncryptionTarget = {
  table: string;
  idCol: string;
  valCol: string;
};

const TARGETS = [
  { table: "ea_accounts", idCol: "id", valCol: "credentials_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "actual_budget_password_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_api_token_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_oauth_refresh_token_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "discord_webhook_url_encrypted" },
] satisfies EncryptionTarget[];

function encryptedRowValues(row: Row): { id: string; val: string } {
  const { id, val } = row;
  if (typeof id !== "string" || typeof val !== "string") {
    throw new TypeError("Encryption migration expected string id and ciphertext values");
  }
  return { id, val };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rewriteColumn({ table, idCol, valCol }: EncryptionTarget) {
  const { rows } = await db.execute({
    sql: `SELECT ${idCol} AS id, ${valCol} AS val FROM ${table}
          WHERE ${valCol} IS NOT NULL AND ${valCol} NOT LIKE 'gcm:%'`,
    args: [],
  });
  for (const row of rows) {
    const { id, val } = encryptedRowValues(row);
    const rewrapped = encrypt(decrypt(val));
    await db.execute({
      sql: `UPDATE ${table} SET ${valCol} = ? WHERE ${idCol} = ?`,
      args: [rewrapped, id],
    });
  }
  return rows.length;
}

export async function migrateCbcEncryption() {
  if (!process.env.EA_ENCRYPTION_KEY) return;
  let total = 0;
  for (const target of TARGETS) {
    try {
      total += await rewriteColumn(target);
    } catch (err: unknown) {
      const message = errorMessage(err);
      // A missing column (schema older than expected) shouldn't block startup.
      if (/no such column|no such table/i.test(message)) continue;
      console.error(
        `[Encryption] CBC rewrite failed for ${target.table}.${target.valCol}:`,
        message,
      );
    }
  }
  if (total > 0) {
    console.log(`[Encryption] Rewrote ${total} CBC value(s) to GCM.`);
  }
}
