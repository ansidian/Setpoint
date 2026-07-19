import crypto from "crypto";
import db from "../db/connection.ts";
import type { Request, RequestHandler } from "express";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_TOKEN_PREFIX = "sha256:";

// P2-27: every authenticated /api request validates the session token, which in
// production is a remote Turso round-trip. For a single user the token is static
// between ~monthly logins, so memoize a positive validation for a short TTL keyed
// by the hashed token. Only positive, unexpired results are cached; negatives and
// expirations always fall through to the DB. Invalidated on logout (deleteSession)
// and on full revocation (session-rotation); the TTL bounds any missed
// invalidation to a few tens of seconds.
const SESSION_CACHE_TTL_MS = 30_000;
type SessionCacheEntry = { expiresAt: number; cachedAt: number };
export type ApiTokenContext = { id: string | number; scopes: string[] };
type RequestWithApiToken = Request & { apiToken?: ApiTokenContext };

const sessionValidationCache = new Map<string, SessionCacheEntry>();

export function __clearSessionValidationCache() {
  sessionValidationCache.clear();
}

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
  sessionValidationCache.delete(hashSessionToken(token));
}

export async function createSession({ authenticatedAt = Date.now() }: { authenticatedAt?: number } = {}) {
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
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at, authenticated_at) VALUES (?, ?, ?)",
    args: [hashSessionToken(token), expiresAt, authenticatedAt],
  });
  return token;
}

export async function hasRecentAuth(
  token: string | null | undefined,
  { now = Date.now(), maxAgeMs = RECENT_AUTH_MAX_AGE_MS }: { now?: number; maxAgeMs?: number } = {},
): Promise<boolean> {
  if (!token) return false;
  const result = await db.execute({
    sql: "SELECT expires_at, authenticated_at FROM ea_sessions WHERE token IN (?, ?)",
    args: [hashSessionToken(token), token],
  });
  const row = result.rows[0];
  if (!row) return false;
  const expiresAt = numberValue(row.expires_at);
  const authenticatedAt = numberValue(row.authenticated_at);
  return Boolean(
    expiresAt && expiresAt >= now
    && authenticatedAt && authenticatedAt <= now
    && now - authenticatedAt <= maxAgeMs,
  );
}

export async function markSessionRecentlyAuthenticated(
  token: string | null | undefined,
  authenticatedAt = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const result = await db.execute({
    sql: "UPDATE ea_sessions SET authenticated_at = ? WHERE token IN (?, ?)",
    args: [authenticatedAt, hashSessionToken(token), token],
  });
  return result.rowsAffected > 0;
}

export async function validateSession(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const hashedToken = hashSessionToken(token);

  // P2-27: serve a recent positive validation from the in-process cache, skipping
  // the remote Turso SELECT. A cached entry is honored only within the TTL and
  // only while still unexpired; otherwise drop it and fall through to the DB
  // (which also runs the legacy-token migration and lazy expiry cleanup).
  const nowMs = Date.now();
  const cached = sessionValidationCache.get(hashedToken);
  if (cached && nowMs - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    if (nowMs <= cached.expiresAt) return true;
    sessionValidationCache.delete(hashedToken);
  }

  let result = await db.execute({
    sql: "SELECT expires_at FROM ea_sessions WHERE token = ?",
    args: [hashedToken],
  });
  let storedToken = hashedToken;

  if (!result.rows.length) {
    result = await db.execute({
      sql: "SELECT expires_at FROM ea_sessions WHERE token = ?",
      args: [token],
    });
    storedToken = token;
  }
  if (!result.rows.length) return false;
  const expiresAt = numberValue(result.rows[0]!.expires_at);
  if (!expiresAt || Date.now() > expiresAt) {
    // Lazy cleanup — delete expired session
    await db.execute({
      sql: "DELETE FROM ea_sessions WHERE token = ?",
      args: [storedToken],
    });
    sessionValidationCache.delete(hashedToken);
    return false;
  }
  if (storedToken === token) {
    await db.execute({
      sql: "UPDATE ea_sessions SET token = ? WHERE token = ?",
      args: [hashedToken, token],
    }).catch((err: unknown) => console.error("[EA] session hash migration failed:", errorMessage(err)));
  }
  sessionValidationCache.set(hashedToken, {
    expiresAt,
    cachedAt: Date.now(),
  });
  return true;
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

export const requireCookieSession: RequestHandler = async (req, res, next) => {
  try {
    if (await validateSession(req.cookies?.ea_session)) {
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

export const requireRecentAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.ea_session;
    if (!await validateSession(token)) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!await hasRecentAuth(token)) {
      return res.status(403).json({
        code: "STEP_UP_REQUIRED",
        message: "Confirm your password or passkey to continue",
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

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
