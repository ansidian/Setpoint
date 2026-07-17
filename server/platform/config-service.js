import db from "../db/connection.ts";
import { canonicalizeConfiguredAccounts } from "./account-canonical.js";

export async function loadUserConfig(userId) {
  const accountsResult = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
    args: [userId],
  });
  const accounts = canonicalizeConfiguredAccounts(accountsResult.rows);

  const settingsResult = await db.execute({
    sql: "SELECT * FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  let settings = settingsResult.rows[0];

  if (!settings) {
    await db.execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: [userId],
    });
    const defaultResult = await db.execute({
      sql: "SELECT * FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    settings = defaultResult.rows[0];
  }

  return { accounts, settings };
}
