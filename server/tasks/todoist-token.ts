import db from "../db/connection.ts";
import { decrypt, encrypt } from "../platform/encryption.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { isInvalidGrantError, markTodoistNeedsReauth, clearTodoistNeedsReauth } from "../platform/provider-reauth.ts";
import type { Client } from "@libsql/client";
import type { FetchFunction } from "../platform/fetch-with-timeout.ts";
import { todoistOAuthCredentialManager } from "./todoist-oauth-credentials.ts";

const TODOIST_OAUTH_TOKEN_URL = "https://api.todoist.com/oauth/access_token";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const OAUTH_TOKEN_TIMEOUT_MS = 10_000;

export class TodoistOAuthRefreshError extends Error {
  status: number | null;
  body: string;

  constructor(message: string, { status = null, body = "" }: { status?: number | null; body?: string } = {}) {
    super(message);
    this.name = "TodoistOAuthRefreshError";
    this.status = status;
    this.body = body;
  }
}

export interface TodoistOAuthTokenResponse extends Record<string, unknown> {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  issued_at?: string | null;
  expires_in?: number | string | null;
  scope?: string | null;
  token_type?: string | null;
}

interface TodoistTokenSettingsRow {
  todoist_api_token_encrypted?: string | null;
  todoist_oauth_refresh_token_encrypted?: string | null;
  todoist_oauth_access_token_expires_at?: string | null;
  todoist_oauth_scope?: string | null;
  todoist_oauth_token_type?: string | null;
  todoist_needs_reauth?: number | boolean | null;
  todoist_connection_mode?: string | null;
}

type TodoistTokenDb = Client;

interface TodoistOAuthFetchResponse {
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

interface TodoistTokenEnvironment {
  TODOIST_CLIENT_ID?: string;
  TODOIST_CLIENT_SECRET?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encrypted(value: string | null | undefined): string | null {
  return value ? encrypt(value) : null;
}

function decrypted(value: string | null | undefined): string | null {
  return value ? decrypt(value) : null;
}

function expiresAtFromResponse(response: TodoistOAuthTokenResponse, now: Date): string | null {
  if (response.expires_at) {
    return new Date(response.expires_at).toISOString();
  }
  if (response.issued_at) {
    const expiresIn = Number(response.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
    return new Date(new Date(response.issued_at).getTime() + expiresIn * 1000).toISOString();
  }
  const expiresIn = Number(response.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(now.getTime() + expiresIn * 1000).toISOString();
}

function isFresh(expiresAt: string | null | undefined, now: Date, refreshSkewMs: number): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now.getTime() > refreshSkewMs;
}

async function loadTodoistTokenSettings(userId: string, dbClient: TodoistTokenDb): Promise<TodoistTokenSettingsRow | null> {
  try {
    const result = await dbClient.execute({
      sql: `SELECT todoist_api_token_encrypted,
                   todoist_oauth_refresh_token_encrypted,
                   todoist_oauth_access_token_expires_at,
                   todoist_oauth_scope,
                   todoist_oauth_token_type,
                   todoist_needs_reauth
            FROM ea_settings
            WHERE user_id = ?`,
      args: [userId],
    });
    return result.rows[0] as unknown as TodoistTokenSettingsRow | undefined || null;
  } catch (err) {
    if (!/no such column/i.test(errorMessage(err))) throw err;
    const result = await dbClient.execute({
      sql: "SELECT todoist_api_token_encrypted FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return result.rows[0] as unknown as TodoistTokenSettingsRow | undefined || null;
  }
}

async function refreshTodoistOAuthToken({
  refreshToken,
  credentials,
  fetchFn,
}: {
  refreshToken?: string | null;
  credentials: { clientId: string; clientSecret: string };
  fetchFn: FetchFunction<TodoistOAuthFetchResponse>;
}): Promise<TodoistOAuthTokenResponse> {
  const { clientId, clientSecret } = credentials;
  if (!clientId || !clientSecret) {
    throw new TodoistOAuthRefreshError("Todoist OAuth refresh is not configured");
  }
  if (!refreshToken) {
    throw new TodoistOAuthRefreshError("Todoist OAuth refresh token is missing");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetchWithTimeout(TODOIST_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, { timeoutMs: OAUTH_TOKEN_TIMEOUT_MS, fetchFn });

  if (!res.ok) {
    const text = await res.text!().catch(() => "");
    throw new TodoistOAuthRefreshError(`Todoist OAuth refresh failed (${res.status})`, {
      status: res.status ?? null,
      body: text,
    });
  }

  const response = await res.json!() as Partial<TodoistOAuthTokenResponse>;
  if (typeof response.access_token !== "string" || !response.access_token) {
    throw new TodoistOAuthRefreshError("Todoist OAuth refresh response did not include an access token");
  }
  return response as TodoistOAuthTokenResponse;
}

async function persistTodoistOAuthTokenResponse(userId: string, response: TodoistOAuthTokenResponse, {
  dbClient,
  now,
  existingRefreshTokenEncrypted = null,
}: {
  dbClient: TodoistTokenDb;
  now: Date;
  existingRefreshTokenEncrypted?: string | null;
}): Promise<{ accessToken: string; expiresAt: string | null }> {
  const expiresAt = expiresAtFromResponse(response, now);
  const refreshTokenEncrypted = response.refresh_token
    ? encrypted(response.refresh_token)
    : existingRefreshTokenEncrypted;

  await dbClient.execute({
    sql: `UPDATE ea_settings
          SET todoist_api_token_encrypted = ?,
              todoist_oauth_refresh_token_encrypted = ?,
              todoist_oauth_access_token_expires_at = ?,
              todoist_oauth_scope = ?,
              todoist_oauth_token_type = ?,
              todoist_connection_mode = 'oauth'
          WHERE user_id = ?`,
    args: [
      encrypted(response.access_token),
      refreshTokenEncrypted,
      expiresAt,
      response.scope || null,
      response.token_type || "Bearer",
      userId,
    ],
  });

  return {
    accessToken: response.access_token,
    expiresAt,
  };
}

export async function storeTodoistOAuthTokenResponse(userId: string, response: TodoistOAuthTokenResponse, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: TodoistTokenDb; now?: Date } = {}): Promise<{ accessToken: string; expiresAt: string | null }> {
  if (!response?.access_token) {
    throw new TodoistOAuthRefreshError("Todoist OAuth token response is missing access_token");
  }
  await dbClient.execute({
    sql: "INSERT OR IGNORE INTO ea_settings (user_id) VALUES (?)",
    args: [userId],
  });
  return persistTodoistOAuthTokenResponse(userId, response, {
    dbClient,
    now,
  });
}

export async function getTodoistApiToken(userId: string, {
  dbClient = db,
  env,
  resolveApplicationCredentials,
  fetchFn = fetch,
  now = new Date(),
  refreshSkewMs = REFRESH_SKEW_MS,
}: {
  dbClient?: TodoistTokenDb;
  env?: TodoistTokenEnvironment;
  resolveApplicationCredentials?: () => Promise<{ clientId: string; clientSecret: string }>;
  fetchFn?: FetchFunction<TodoistOAuthFetchResponse>;
  now?: Date;
  refreshSkewMs?: number;
} = {}): Promise<string | null> {
  const settings = await loadTodoistTokenSettings(userId, dbClient);
  if (!settings) return null;
  const accessToken = decrypted(settings?.todoist_api_token_encrypted);
  if (!accessToken) return null;

  const refreshTokenEncrypted = settings?.todoist_oauth_refresh_token_encrypted || null;
  if (!refreshTokenEncrypted) return accessToken;

  if (isFresh(settings.todoist_oauth_access_token_expires_at, now, refreshSkewMs)) {
    return accessToken;
  }

  let response: TodoistOAuthTokenResponse;
  try {
    const credentials = resolveApplicationCredentials
      ? await resolveApplicationCredentials()
      : env
        ? {
            clientId: env.TODOIST_CLIENT_ID || "",
            clientSecret: env.TODOIST_CLIENT_SECRET || "",
          }
        : await todoistOAuthCredentialManager.resolveActive();
    response = await refreshTodoistOAuthToken({
      refreshToken: decrypted(refreshTokenEncrypted),
      credentials,
      fetchFn,
    });
  } catch (err) {
    if (isInvalidGrantError(err instanceof TodoistOAuthRefreshError ? err.body : "")) {
      try {
        await markTodoistNeedsReauth(userId, { dbClient });
      } catch (markErr) {
        console.error("[Todoist] Failed to mark todoist_needs_reauth:", errorMessage(markErr));
      }
    }
    throw err;
  }
  const stored = await persistTodoistOAuthTokenResponse(userId, response, {
    dbClient,
    now,
    existingRefreshTokenEncrypted: refreshTokenEncrypted,
  });

  if (settings.todoist_needs_reauth) {
    try {
      await clearTodoistNeedsReauth(userId, { dbClient });
    } catch (clearErr) {
      console.error("[Todoist] Failed to clear todoist_needs_reauth:", errorMessage(clearErr));
    }
  }

  return stored.accessToken;
}
