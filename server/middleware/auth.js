import crypto from "crypto";
import db from "../db/connection.js";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function validateBearer(raw) {
  if (!raw) return null;
  const result = await db.execute({
    sql: "SELECT id, scopes, expires_at FROM ea_api_tokens WHERE token_hash = ?",
    args: [hashToken(raw)],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (row.expires_at && Date.now() > row.expires_at) return null;
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
    sql: "DELETE FROM ea_sessions WHERE token = ?",
    args: [token],
  });
}

export async function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [token, expiresAt],
  });
  return token;
}

export async function validateSession(token) {
  if (!token) return false;
  const result = await db.execute({
    sql: "SELECT expires_at FROM ea_sessions WHERE token = ?",
    args: [token],
  });
  if (!result.rows.length) return false;
  if (Date.now() > result.rows[0].expires_at) {
    // Lazy cleanup — delete expired session
    await db.execute({
      sql: "DELETE FROM ea_sessions WHERE token = ?",
      args: [token],
    });
    return false;
  }
  return true;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

export async function requireCookieSession(req, res, next) {
  if (await validateSession(req.cookies?.ea_session)) {
    return next();
  }
  return res.status(401).json({ message: "Not authenticated" });
}

export function requireApiTokenScope(requiredScope) {
  return async function requireScopedApiToken(req, res, next) {
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
  };
}

export function requireCookieSessionOrApiTokenScope(requiredScope) {
  return async function requireCookieOrScopedToken(req, res, next) {
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
  };
}
