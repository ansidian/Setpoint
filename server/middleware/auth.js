import crypto from "crypto";
import db from "../db/connection.js";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TOKEN_PREFIX = "sha256:";

// P2-27: every authenticated /api request validates the session token, which in
// production is a remote Turso round-trip. For a single user the token is static
// between ~monthly logins, so memoize a positive validation for a short TTL keyed
// by the hashed token. Only positive, unexpired results are cached; negatives and
// expirations always fall through to the DB. Invalidated on logout (deleteSession)
// and on full revocation (session-rotation); the TTL bounds any missed
// invalidation to a few tens of seconds.
const SESSION_CACHE_TTL_MS = 30_000;
const sessionValidationCache = new Map(); // hashedToken -> { expiresAt, cachedAt }

export function __clearSessionValidationCache() {
  sessionValidationCache.clear();
}

export function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function hashSessionToken(raw) {
  return SESSION_TOKEN_PREFIX + hashToken(raw);
}

export async function validateBearer(raw) {
  if (!raw) return null;
  const result = await db.execute({
    sql: "SELECT id, scopes, expires_at FROM ea_api_tokens WHERE token_hash = ?",
    args: [hashToken(raw)],
  });
  const row = result.rows[0];
  if (!row) return null;
  // Fail closed: a NULL/0 expires_at (legacy rows predating API_TOKEN_TTL) is
  // treated as expired so it cannot outlive token rotation. expires_at is ms.
  if (!row.expires_at || Date.now() > row.expires_at) return null;
  // Fire-and-forget last_used update; don't block request on it
  db.execute({
    sql: "UPDATE ea_api_tokens SET last_used_at = ? WHERE id = ?",
    args: [Date.now(), row.id],
  }).catch((err) => console.error("[EA] api-token last_used update failed:", err.message));
  let scopes = [];
  try { scopes = JSON.parse(row.scopes); } catch { scopes = []; }
  return { id: row.id, scopes };
}

export async function deleteSession(token) {
  await db.execute({
    sql: "DELETE FROM ea_sessions WHERE token IN (?, ?)",
    args: [token, hashSessionToken(token)],
  });
  sessionValidationCache.delete(hashSessionToken(token));
}

export async function createSession() {
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
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken(token), expiresAt],
  });
  return token;
}

export async function validateSession(token) {
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
  if (Date.now() > result.rows[0].expires_at) {
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
    }).catch((err) => console.error("[EA] session hash migration failed:", err.message));
  }
  sessionValidationCache.set(hashedToken, {
    expiresAt: result.rows[0].expires_at,
    cachedAt: Date.now(),
  });
  return true;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

export async function requireCookieSession(req, res, next) {
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
}

export function requireApiTokenScope(requiredScope) {
  return async function requireScopedApiToken(req, res, next) {
    try {
      const raw = getBearerToken(req);
      if (!raw) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const ctx = await validateBearer(raw);
      if (!ctx) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (!ctx.scopes.includes(requiredScope)) {
        return res.status(403).json({ message: `Token lacks ${requiredScope} scope` });
      }

      req.apiToken = ctx;
      return next();
    } catch (err) {
      return next(err); // forward DB faults instead of hanging (P1-12)
    }
  };
}

export function requireCookieSessionOrApiTokenScope(requiredScope) {
  return async function requireCookieOrScopedToken(req, res, next) {
    try {
      const raw = getBearerToken(req);
      if (raw) {
        const ctx = await validateBearer(raw);
        if (ctx?.scopes.includes(requiredScope)) {
          req.apiToken = ctx;
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
