import db from "./connection.js";
import { encrypt, decrypt } from "../briefing/encryption.js";

// One-shot rewrite of legacy CBC-encrypted column values into GCM format.
// `decrypt()` is backwards-compatible, but the legacy path warns on every
// call — walking these columns at startup turns that recurring warn into a
// single migration log line.
const TARGETS = [
  { table: "ea_accounts", idCol: "id", valCol: "credentials_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "actual_budget_password_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_api_token_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_oauth_refresh_token_encrypted" },
];

async function rewriteColumn({ table, idCol, valCol }) {
  const { rows } = await db.execute({
    sql: `SELECT ${idCol} AS id, ${valCol} AS val FROM ${table}
          WHERE ${valCol} IS NOT NULL AND ${valCol} NOT LIKE 'gcm:%'`,
    args: [],
  });
  for (const { id, val } of rows) {
    const rewrapped = encrypt(decrypt(val));
    await db.execute({
      sql: `UPDATE ${table} SET ${valCol} = ? WHERE ${idCol} = ?`,
      args: [rewrapped, id],
    });
  }
  return rows.length;
}

export async function migrateLegacyEncryption() {
  if (!process.env.EA_ENCRYPTION_KEY) return;
  let total = 0;
  for (const target of TARGETS) {
    try {
      total += await rewriteColumn(target);
    } catch (err) {
      // A missing column (schema older than expected) shouldn't block startup.
      if (/no such column|no such table/i.test(err.message)) continue;
      console.error(
        `[Encryption] Legacy rewrite failed for ${target.table}.${target.valCol}:`,
        err.message,
      );
    }
  }
  if (total > 0) {
    console.log(`[Encryption] Rewrote ${total} legacy CBC value(s) to GCM.`);
  }
}
