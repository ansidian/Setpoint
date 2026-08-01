import db from "../db/connection.ts";
import { canonicalizeConfiguredAccounts } from "./account-canonical.ts";
import type { InStatement, Row } from "@libsql/client";

export type CanonicalAccount = Row;
export type CanonicalSettings = Row;
export type UserConfig = {
  accounts: CanonicalAccount[];
  settings: CanonicalSettings | undefined;
};

interface SettingsReadDb {
  execute(statement: string | InStatement): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function getEmailTriageClassifyReadArrivalsForUser(userId: string, {
  dbClient = db as unknown as SettingsReadDb,
}: { dbClient?: SettingsReadDb } = {}): Promise<boolean> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT email_triage_classify_read_arrivals FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return Number(result.rows?.[0]?.email_triage_classify_read_arrivals || 0) === 1;
  } catch {
    return false;
  }
}

export async function loadUserConfig(userId: string): Promise<UserConfig> {
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
