import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import { encrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import { fetchTodoistSyncResources } from "./todoist-api.ts";

type TodoistPersonalTokenValidator = (token: string) => Promise<unknown>;

async function validateTodoistPersonalToken(token: string): Promise<void> {
  try {
    await fetchTodoistSyncResources({
      token,
      resourceTypes: ["projects"],
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
    console.warn(`[Todoist] Personal token verification failed${status ? ` (${status})` : ""}`);
    throw Object.assign(new Error("Todoist personal token could not be verified"), {
      status: status === 401 || status === 403 ? 400 : 502,
    });
  }
}

export async function saveTodoistPersonalTokenCandidate(
  userId: string,
  tokenValue: string,
  {
    dbClient = db,
    encryptValue = (value) => encrypt(
      value,
      settingsCredentialContext(userId, "todoist_api_token_encrypted"),
    ),
    validateToken = validateTodoistPersonalToken,
    now = new Date(),
  }: {
    dbClient?: Client;
    encryptValue?: (value: string) => string;
    validateToken?: TodoistPersonalTokenValidator;
    now?: Date;
  } = {},
) {
  const token = tokenValue.trim();
  if (!token) {
    throw Object.assign(new Error("Todoist personal token is required"), { status: 400 });
  }

  try {
    await validateToken(token);
  } catch (error) {
    if (error instanceof Error && error.message === "Todoist personal token could not be verified") {
      throw error;
    }
    throw Object.assign(new Error("Todoist personal token could not be verified"), { status: 400 });
  }

  const verifiedAt = now.toISOString();
  const tx = await dbClient.transaction("write");
  try {
    await tx.execute({
      sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)",
      args: [userId],
    });
    await tx.execute({
      sql: `UPDATE ea_settings
            SET todoist_api_token_encrypted = ?,
                todoist_oauth_refresh_token_encrypted = NULL,
                todoist_oauth_access_token_expires_at = NULL,
                todoist_oauth_scope = NULL,
                todoist_oauth_token_type = NULL,
                todoist_connection_mode = 'personal_token',
                todoist_needs_reauth = 0
            WHERE user_id = ?`,
      args: [encryptValue(token), userId],
    });
    await tx.execute({
      sql: `INSERT INTO ea_todoist_sync_state
              (user_id, status, last_success_at, last_error, last_check_failed_at,
               failed_check_count, updated_at)
            VALUES (?, 'idle', ?, NULL, NULL, 0, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              status = 'idle',
              last_success_at = excluded.last_success_at,
              last_error = NULL,
              last_check_failed_at = NULL,
              failed_check_count = 0,
              updated_at = excluded.updated_at`,
      args: [userId, verifiedAt, verifiedAt],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }

  return { success: true as const, verifiedAt };
}

export async function disconnectTodoistConnection(
  userId: string,
  { dbClient = db }: { dbClient?: Client } = {},
): Promise<{ success: true }> {
  const tx = await dbClient.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE ea_settings
            SET todoist_api_token_encrypted = NULL,
                todoist_oauth_refresh_token_encrypted = NULL,
                todoist_oauth_access_token_expires_at = NULL,
                todoist_oauth_scope = NULL,
                todoist_oauth_token_type = NULL,
                todoist_connection_mode = NULL,
                todoist_needs_reauth = 0
            WHERE user_id = ?`,
      args: [userId],
    });
    await tx.execute({
      sql: "DELETE FROM ea_completed_tasks WHERE user_id = ?",
      args: [userId],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  return { success: true };
}
