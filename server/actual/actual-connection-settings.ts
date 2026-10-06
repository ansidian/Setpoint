import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import { encrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import {
  ActualPasswordRequiredForServerChangeError,
  isSameActualServerUrl,
  testActualConnectionHttp,
} from "./actual-connection-test.ts";

export interface ActualConnectionCandidate {
  serverURL: string;
  password?: string | null;
  syncId: string;
  /** A non-empty value replaces the stored encryption password; null removes it; absent keeps it. */
  encryptionPassword?: string | null;
}

type ActualConnectionTest = typeof testActualConnectionHttp;

export async function saveActualConnectionCandidate(
  userId: string,
  candidate: ActualConnectionCandidate,
  {
    dbClient = db,
    encryptValue = (value, field = "actual_budget_password_encrypted") => encrypt(
      value,
      settingsCredentialContext(userId, field),
    ),
    testConnection = testActualConnectionHttp,
    now = () => new Date(),
  }: {
    dbClient?: Client;
    encryptValue?: (value: string, field?: "actual_budget_password_encrypted" | "actual_budget_encryption_password_encrypted") => string;
    testConnection?: ActualConnectionTest;
    now?: () => Date;
  } = {},
) {
  const serverURL = candidate.serverURL.trim().replace(/\/+$/, "");
  const syncId = candidate.syncId.trim();
  const password = candidate.password?.trim() || null;
  const encryptionPassword = candidate.encryptionPassword === null ? null : candidate.encryptionPassword || undefined;
  if (!password) {
    const current = await dbClient.execute({
      sql: `SELECT actual_budget_url, actual_budget_password_encrypted
            FROM ea_settings WHERE user_id = ?`,
      args: [userId],
    });
    const stored = current.rows[0];
    if (stored?.actual_budget_password_encrypted
      && !isSameActualServerUrl(serverURL, stored.actual_budget_url)) {
      throw new ActualPasswordRequiredForServerChangeError();
    }
  }
  const verification = await testConnection(userId, {
    serverURL,
    syncId,
    ...(password ? { password } : {}),
    ...(encryptionPassword !== undefined ? { encryptionPassword } : {}),
  });

  if (!verification.budgetFound) {
    throw Object.assign(new Error("The supplied Actual Budget sync ID was not found"), { status: 400 });
  }
  const verifiedAt = now().toISOString();

  const tx = await dbClient.transaction("write");
  try {
    await tx.execute({
      sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)",
      args: [userId],
    });
    if (password) {
      await tx.execute({
        sql: `UPDATE ea_settings
              SET actual_budget_url = ?,
                  actual_budget_password_encrypted = ?,
                  actual_budget_sync_id = ?
              WHERE user_id = ?`,
        args: [serverURL, encryptValue(password), syncId, userId],
      });
    } else {
      await tx.execute({
        sql: `UPDATE ea_settings
              SET actual_budget_url = ?, actual_budget_sync_id = ?
              WHERE user_id = ?`,
        args: [serverURL, syncId, userId],
      });
    }
    if (encryptionPassword !== undefined) {
      await tx.execute({
        sql: "UPDATE ea_settings SET actual_budget_encryption_password_encrypted = ? WHERE user_id = ?",
        args: [encryptionPassword ? encryptValue(encryptionPassword, "actual_budget_encryption_password_encrypted") : null, userId],
      });
    }
    await tx.execute({
      sql: `INSERT INTO ea_actual_metadata_mirror
              (user_id, status, last_success_at, last_attempt_at, last_error, updated_at)
            VALUES (?, 'ready', ?, ?, NULL, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              status = 'ready',
              last_success_at = excluded.last_success_at,
              last_attempt_at = excluded.last_attempt_at,
              last_error = NULL,
              updated_at = excluded.updated_at`,
      args: [userId, verifiedAt, verifiedAt, verifiedAt],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }

  return {
    success: true as const,
    budgetCount: verification.budgetCount,
    budgetFound: true as const,
    budgetEncrypted: verification.budgetEncrypted,
    verifiedAt,
  };
}

export async function removeActualConnection(
  userId: string,
  { dbClient = db }: { dbClient?: Client } = {},
): Promise<{ success: true }> {
  await dbClient.execute({
    sql: `UPDATE ea_settings
          SET actual_budget_url = NULL,
              actual_budget_password_encrypted = NULL,
              actual_budget_sync_id = NULL,
              actual_budget_encryption_password_encrypted = NULL
          WHERE user_id = ?`,
    args: [userId],
  });
  return { success: true };
}
