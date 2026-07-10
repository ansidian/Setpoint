import db from "./connection.js";
import { encrypt, decrypt } from "../platform/encryption.js";

// One-shot rewrite of CBC-encrypted column values into GCM format.
// `decrypt()` now REJECTS (throws on) non-GCM ciphertext (see
// ../platform/encryption.js) rather than decrypting it — so this migration can
// only succeed on rows that already round-trip through GCM. Any lingering CBC
// straggler makes rewriteColumn() throw for that row; the per-target
// try/catch below logs it and moves on without retrying. In practice this
// makes the migration inert unless a legacy CBC row resurfaces (e.g. restored
// from an old backup), in which case it surfaces via the logged error rather
// than rewriting the value.
const TARGETS = [
  { table: "ea_accounts", idCol: "id", valCol: "credentials_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "actual_budget_password_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_api_token_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "todoist_oauth_refresh_token_encrypted" },
  { table: "ea_settings", idCol: "user_id", valCol: "discord_webhook_url_encrypted" },
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

export async function migrateCbcEncryption() {
  if (!process.env.EA_ENCRYPTION_KEY) return;
  let total = 0;
  for (const target of TARGETS) {
    try {
      total += await rewriteColumn(target);
    } catch (err) {
      // A missing column (schema older than expected) shouldn't block startup.
      if (/no such column|no such table/i.test(err.message)) continue;
      console.error(
        `[Encryption] CBC rewrite failed for ${target.table}.${target.valCol}:`,
        err.message,
      );
    }
  }
  if (total > 0) {
    console.log(`[Encryption] Rewrote ${total} CBC value(s) to GCM.`);
  }
}
