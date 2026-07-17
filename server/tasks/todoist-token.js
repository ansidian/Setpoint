import db from "../db/connection.ts";
import { decrypt, encrypt } from "../platform/encryption.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { isInvalidGrantError, markTodoistNeedsReauth, clearTodoistNeedsReauth } from "../platform/provider-reauth.ts";

const TODOIST_OAUTH_TOKEN_URL = "https://api.todoist.com/oauth/access_token";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const OAUTH_TOKEN_TIMEOUT_MS = 10_000;

export class TodoistOAuthRefreshError extends Error {
  constructor(message, { status = null, body = "" } = {}) {
    super(message);
    this.name = "TodoistOAuthRefreshError";
    this.status = status;
    this.body = body;
  }
}

function encrypted(value) {
  return value ? encrypt(value) : null;
}

function decrypted(value) {
  return value ? decrypt(value) : null;
}

function expiresAtFromResponse(response, now) {
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

function isFresh(expiresAt, now, refreshSkewMs) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now.getTime() > refreshSkewMs;
}

async function loadTodoistTokenSettings(userId, dbClient) {
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
    return result.rows[0] || null;
  } catch (err) {
    if (!/no such column/i.test(err.message)) throw err;
    const result = await dbClient.execute({
      sql: "SELECT todoist_api_token_encrypted FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return result.rows[0] || null;
  }
}

async function refreshTodoistOAuthToken({
  refreshToken,
  env,
  fetchFn,
} = {}) {
  const clientId = env.TODOIST_CLIENT_ID;
  const clientSecret = env.TODOIST_CLIENT_SECRET;
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
    const text = await res.text().catch(() => "");
    throw new TodoistOAuthRefreshError(`Todoist OAuth refresh failed (${res.status})`, {
      status: res.status,
      body: text,
    });
  }

  const response = await res.json();
  if (!response.access_token) {
    throw new TodoistOAuthRefreshError("Todoist OAuth refresh response did not include an access token");
  }
  return response;
}

async function persistTodoistOAuthTokenResponse(userId, response, {
  dbClient,
  now,
  existingRefreshTokenEncrypted = null,
} = {}) {
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
              todoist_oauth_token_type = ?
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

export async function storeTodoistOAuthTokenResponse(userId, response, {
  dbClient = db,
  now = new Date(),
} = {}) {
  if (!response?.access_token) {
    throw new TodoistOAuthRefreshError("Todoist OAuth token response is missing access_token");
  }
  if (!response.refresh_token) {
    throw new TodoistOAuthRefreshError("Todoist OAuth token response is missing refresh_token");
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

export async function getTodoistApiToken(userId, {
  dbClient = db,
  env = process.env,
  fetchFn = fetch,
  now = new Date(),
  refreshSkewMs = REFRESH_SKEW_MS,
} = {}) {
  const settings = await loadTodoistTokenSettings(userId, dbClient);
  const accessToken = decrypted(settings?.todoist_api_token_encrypted);
  if (!accessToken) return null;

  const refreshTokenEncrypted = settings?.todoist_oauth_refresh_token_encrypted || null;
  if (!refreshTokenEncrypted) return accessToken;

  if (isFresh(settings.todoist_oauth_access_token_expires_at, now, refreshSkewMs)) {
    return accessToken;
  }

  let response;
  try {
    response = await refreshTodoistOAuthToken({
      refreshToken: decrypted(refreshTokenEncrypted),
      env,
      fetchFn,
    });
  } catch (err) {
    if (isInvalidGrantError(err.body)) {
      try {
        await markTodoistNeedsReauth(userId, { dbClient });
      } catch (markErr) {
        console.error("[Todoist] Failed to mark todoist_needs_reauth:", markErr.message);
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
      console.error("[Todoist] Failed to clear todoist_needs_reauth:", clearErr.message);
    }
  }

  return stored.accessToken;
}

export const __testing__ = {
  TODOIST_OAUTH_TOKEN_URL,
  expiresAtFromResponse,
  isFresh,
};
