import crypto from "crypto";
import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import type { Request, RequestHandler } from "express";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
export const PASSWORD_STEP_UP_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_STEP_UP_MAX_FAILURES = 5;
const SESSION_TOKEN_PREFIX = "sha256:";

export type SessionAuthMethod = "legacy" | "password" | "passkey" | "password_plus_passkey" | "recovery";
export type SessionSecurityContext = {
  expiresAt: number;
  authenticatedAt: number;
  passwordAuthenticatedAt: number;
  securityGeneration: number;
  authMethod: SessionAuthMethod;
};
export type ApiTokenContext = { id: string | number; scopes: string[] };
type RequestWithApiToken = Request & { apiToken?: ApiTokenContext };

export function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function hashSessionToken(raw: string) {
  return SESSION_TOKEN_PREFIX + hashToken(raw);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function identifierValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function validateBearer(raw: string | null | undefined): Promise<ApiTokenContext | null> {
  if (!raw) return null;
  const result = await db.execute({
    sql: "SELECT id, scopes, expires_at FROM ea_api_tokens WHERE token_hash = ?",
    args: [hashToken(raw)],
  });
  const row = result.rows[0];
  if (!row) return null;
  // Fail closed: a NULL/0 expires_at (legacy rows predating API_TOKEN_TTL) is
  // treated as expired so it cannot outlive token rotation. expires_at is ms.
  const expiresAt = numberValue(row.expires_at);
  const id = identifierValue(row.id);
  if (!expiresAt || !id || Date.now() > expiresAt) return null;
  // Fire-and-forget last_used update; don't block request on it
  db.execute({
    sql: "UPDATE ea_api_tokens SET last_used_at = ? WHERE id = ?",
    args: [Date.now(), id],
  }).catch((err: unknown) => console.error("[EA] api-token last_used update failed:", errorMessage(err)));
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(stringValue(row.scopes) || "[]");
    scopes = Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch { scopes = []; }
  return { id, scopes };
}

export async function deleteSession(token: string) {
  await db.execute({
    sql: "DELETE FROM ea_sessions WHERE token IN (?, ?)",
    args: [token, hashSessionToken(token)],
  });
}

export async function createSession({
  securityGeneration,
  authMethod,
  authenticatedAt = Date.now(),
  passwordAuthenticatedAt = authMethod === "password" || authMethod === "password_plus_passkey"
    ? authenticatedAt
    : 0,
}: {
  securityGeneration: number;
  authMethod: SessionAuthMethod;
  authenticatedAt?: number;
  passwordAuthenticatedAt?: number;
}): Promise<string | null> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  // P3-18: expired sessions are otherwise never reclaimed (the lazy delete only
  // fires if the exact expired token is re-presented, which never happens once
  // the cookie stops being sent). Opportunistically sweep them on each login
  // using idx_ea_sessions_expires so the table self-prunes.
  await db.execute({
    sql: "DELETE FROM ea_sessions WHERE expires_at < ?",
    args: [Date.now()],
  });
  const inserted = await db.execute({
    sql: `INSERT INTO ea_sessions
            (token, expires_at, authenticated_at, password_authenticated_at,
             security_generation, auth_method)
          SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM ea_owner
              WHERE singleton_id = 1 AND security_generation = ?
           )`,
    args: [
      hashSessionToken(token),
      expiresAt,
      authenticatedAt,
      passwordAuthenticatedAt,
      securityGeneration,
      authMethod,
      securityGeneration,
    ],
  });
  return inserted.rowsAffected === 1 ? token : null;
}

function mapSessionContext(row: Record<string, unknown> | undefined): SessionSecurityContext | null {
  if (!row) return null;
  const expiresAt = numberValue(row.expires_at);
  const authenticatedAt = numberValue(row.authenticated_at);
  const passwordAuthenticatedAt = numberValue(row.password_authenticated_at);
  const securityGeneration = numberValue(row.security_generation);
  const authMethod = stringValue(row.auth_method) as SessionAuthMethod | null;
  if (!expiresAt || authenticatedAt === null || passwordAuthenticatedAt === null
    || !securityGeneration || !authMethod) return null;
  return { expiresAt, authenticatedAt, passwordAuthenticatedAt, securityGeneration, authMethod };
}

export async function getSessionSecurityContext(
  token: string | null | undefined,
  dbClient: Pick<Client, "execute"> = db,
): Promise<SessionSecurityContext | null> {
  if (!token) return null;
  const hashedToken = hashSessionToken(token);
  const nowMs = Date.now();

  const selectSession = async (storedToken: string) => dbClient.execute({
    sql: `SELECT s.expires_at, s.authenticated_at, s.password_authenticated_at,
                 s.security_generation, s.auth_method
            FROM ea_sessions s
            JOIN ea_owner o
              ON o.singleton_id = 1
             AND o.security_generation = s.security_generation
           WHERE s.token = ?`,
    args: [storedToken],
  });

  let result = await selectSession(hashedToken);
  let storedToken = hashedToken;
  if (!result.rows.length) {
    result = await selectSession(token);
    storedToken = token;
  }
  const context = mapSessionContext(result.rows[0] as Record<string, unknown> | undefined);
  if (!context) return null;
  if (nowMs > context.expiresAt) {
    await dbClient.execute({ sql: "DELETE FROM ea_sessions WHERE token = ?", args: [storedToken] });
    return null;
  }
  if (storedToken === token) {
    await dbClient.execute({
      sql: "UPDATE ea_sessions SET token = ? WHERE token = ?",
      args: [hashedToken, token],
    }).catch((err: unknown) => console.error("[EA] session hash migration failed:", errorMessage(err)));
  }
  return context;
}

export async function hasRecentPasswordAuth(
  token: string | null | undefined,
  {
    now = Date.now(),
    maxAgeMs = RECENT_AUTH_MAX_AGE_MS,
    dbClient = db,
  }: { now?: number; maxAgeMs?: number; dbClient?: Pick<Client, "execute"> } = {},
): Promise<boolean> {
  const context = await getSessionSecurityContext(token, dbClient);
  if (!context) return false;
  const { expiresAt, passwordAuthenticatedAt } = context;
  return Boolean(
    expiresAt >= now
    && passwordAuthenticatedAt > 0
    && passwordAuthenticatedAt <= now
    && now - passwordAuthenticatedAt <= maxAgeMs,
  );
}

export async function markSessionPasswordAuthenticated(
  token: string | null | undefined,
  authenticatedAt = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const result = await db.execute({
    sql: `UPDATE ea_sessions
             SET authenticated_at = ?,
                 password_authenticated_at = ?,
                 auth_method = 'password',
                 step_up_failure_count = 0,
                 step_up_blocked_until = 0,
                 step_up_window_started_at = 0
           WHERE token IN (?, ?)
             AND security_generation = (
               SELECT security_generation FROM ea_owner WHERE singleton_id = 1
             )`,
    args: [authenticatedAt, authenticatedAt, hashSessionToken(token), token],
  });
  return result.rowsAffected > 0;
}

export type PasswordStepUpThrottle = {
  failureCount: number;
  blockedUntil: number;
};

export async function getPasswordStepUpThrottle(
  token: string | null | undefined,
  now = Date.now(),
): Promise<PasswordStepUpThrottle | null> {
  if (!token) return null;
  const result = await db.execute({
    sql: `SELECT s.step_up_failure_count, s.step_up_blocked_until, s.step_up_window_started_at
            FROM ea_sessions s
            JOIN ea_owner o
              ON o.singleton_id = 1
             AND o.security_generation = s.security_generation
           WHERE s.token IN (?, ?)`,
    args: [hashSessionToken(token), token],
  });
  const row = result.rows[0];
  if (!row) return null;
  const windowStartedAt = Number(row.step_up_window_started_at || 0);
  const blockedUntil = Number(row.step_up_blocked_until || 0);
  if ((windowStartedAt > 0 && windowStartedAt <= now - PASSWORD_STEP_UP_WINDOW_MS)
    || (blockedUntil > 0 && blockedUntil <= now)) {
    await db.execute({
      sql: `UPDATE ea_sessions
               SET step_up_failure_count = 0,
                   step_up_blocked_until = 0,
                   step_up_window_started_at = 0
             WHERE token IN (?, ?)`,
      args: [hashSessionToken(token), token],
    });
    return { failureCount: 0, blockedUntil: 0 };
  }
  return {
    failureCount: Number(row.step_up_failure_count || 0),
    blockedUntil,
  };
}

export async function recordPasswordStepUpFailure(
  token: string | null | undefined,
  now = Date.now(),
): Promise<PasswordStepUpThrottle | null> {
  if (!token) return null;
  const windowCutoff = now - PASSWORD_STEP_UP_WINDOW_MS;
  const blockedUntil = now + PASSWORD_STEP_UP_WINDOW_MS;
  const result = await db.execute({
    sql: `UPDATE ea_sessions
             SET step_up_failure_count = CASE
                   WHEN step_up_window_started_at = 0 OR step_up_window_started_at <= ? THEN 1
                   ELSE step_up_failure_count + 1
                 END,
                 step_up_window_started_at = CASE
                   WHEN step_up_window_started_at = 0 OR step_up_window_started_at <= ? THEN ?
                   ELSE step_up_window_started_at
                 END,
                 step_up_blocked_until = CASE
                   WHEN (CASE
                     WHEN step_up_window_started_at = 0 OR step_up_window_started_at <= ? THEN 1
                     ELSE step_up_failure_count + 1
                   END) >= ? THEN ?
                   ELSE 0
                 END
           WHERE token IN (?, ?)
             AND security_generation = (
               SELECT security_generation FROM ea_owner WHERE singleton_id = 1
             )
       RETURNING step_up_failure_count, step_up_blocked_until`,
    args: [
      windowCutoff,
      windowCutoff,
      now,
      windowCutoff,
      PASSWORD_STEP_UP_MAX_FAILURES,
      blockedUntil,
      hashSessionToken(token),
      token,
    ],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    failureCount: Number(row.step_up_failure_count || 0),
    blockedUntil: Number(row.step_up_blocked_until || 0),
  };
}

export async function validateSession(token: string | null | undefined): Promise<boolean> {
  return Boolean(await getSessionSecurityContext(token));
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

export function createRequireCookieSession(
  dbClient: Pick<Client, "execute"> = db,
): RequestHandler {
  return async (req, res, next) => {
  try {
    const context = await getSessionSecurityContext(req.cookies?.ea_session, dbClient);
    if (context) {
      res.locals.authSession = context;
      return next();
    }
    return res.status(401).json({ message: "Not authenticated" });
  } catch (err) {
    // This guard runs as non-final middleware and does an unguarded DB read; a
    // transient failure must forward to the terminal errorHandler (a 500) rather
    // than reject and hang the request. wrapRouterAsync only wraps the FINAL
    // handler, so async middleware must guard itself (P1-12).
    return next(err);
  }
  };
}

export const requireCookieSession = createRequireCookieSession();

export function createRequireRecentPasswordAuth(
  dbClient: Pick<Client, "execute"> = db,
): RequestHandler {
  return async (req, res, next) => {
  try {
    const token = req.cookies?.ea_session;
    const context = await getSessionSecurityContext(token, dbClient);
    if (!context) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!await hasRecentPasswordAuth(token, { dbClient })) {
      return res.status(403).json({
        code: "PASSWORD_STEP_UP_REQUIRED",
        message: "Confirm your password to continue",
      });
    }
    res.locals.authSession = context;
    return next();
  } catch (err) {
    return next(err);
  }
  };
}

export const requireRecentPasswordAuth = createRequireRecentPasswordAuth();

export function requireCookieSessionOrApiTokenScope(requiredScope: string): RequestHandler {
  return async function requireCookieOrScopedToken(req, res, next) {
    try {
      const raw = getBearerToken(req);
      if (raw) {
        const ctx = await validateBearer(raw);
        if (ctx?.scopes.includes(requiredScope)) {
          (req as RequestWithApiToken).apiToken = ctx;
          return next();
        }
        if (await validateSession(req.cookies?.ea_session)) {
          return next();
        }
        if (ctx) {
          return res.status(403).json({ message: `Token lacks ${requiredScope} scope` });
        }
        return res.status(401).json({ message: "Not authenticated" });
      }

      return requireCookieSession(req, res, next);
    } catch (err) {
      return next(err); // forward DB faults instead of hanging (P1-12)
    }
  };
}
