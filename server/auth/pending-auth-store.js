import crypto from "crypto";
import db from "../db/connection.ts";

export const PENDING_AUTH_COOKIE_NAME = "ea_pending_auth";
export const PENDING_AUTH_TTL_MS = 5 * 60 * 1000;
const TOKEN_HASH_PREFIX = "sha256:";

export function hashPendingAuthToken(raw) {
  return TOKEN_HASH_PREFIX + crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

export function buildPendingAuthCookieOptions({ now = Date.now(), ttlMs = PENDING_AUTH_TTL_MS } = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ttlMs,
    expires: new Date(now + ttlMs),
    path: "/",
  };
}

function mapPendingAuth(row) {
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

export function createPendingAuthStore(database = db) {
  async function deleteExpired(now = Date.now()) {
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE expires_at <= ?",
      args: [now],
    });
  }

  async function createPendingAuth({ userId, now = Date.now(), ttlMs = PENDING_AUTH_TTL_MS, token } = {}) {
    if (!userId) throw new Error("userId is required");
    const rawToken = token || crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashPendingAuthToken(rawToken);
    const expiresAt = now + ttlMs;
    await deleteExpired(now);
    await database.execute({
      sql: `INSERT INTO ea_pending_auth (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [tokenHash, userId, now, expiresAt],
    });
    return { token: rawToken, tokenHash, userId, createdAt: now, expiresAt };
  }

  async function readPendingAuth(rawToken, { now = Date.now() } = {}) {
    if (!rawToken) return null;
    const tokenHash = hashPendingAuthToken(rawToken);
    const result = await database.execute({
      sql: "SELECT token_hash, user_id, created_at, expires_at FROM ea_pending_auth WHERE token_hash = ?",
      args: [tokenHash],
    });
    const row = result.rows[0];
    if (!row) return null;
    if (Number(row.expires_at) <= now) {
      await database.execute({
        sql: "DELETE FROM ea_pending_auth WHERE token_hash = ?",
        args: [tokenHash],
      });
      return null;
    }
    return mapPendingAuth(row);
  }

  async function consumePendingAuth(rawToken, { now = Date.now() } = {}) {
    const pendingAuth = await readPendingAuth(rawToken, { now });
    if (!pendingAuth) return null;
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE token_hash = ?",
      args: [pendingAuth.tokenHash],
    });
    return pendingAuth;
  }

  async function deletePendingAuth(rawToken) {
    if (!rawToken) return;
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE token_hash = ?",
      args: [hashPendingAuthToken(rawToken)],
    });
  }

  async function deletePendingAuthForUser(userId) {
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE user_id = ?",
      args: [userId],
    });
  }

  async function clearPendingAuth() {
    await database.execute("DELETE FROM ea_pending_auth");
  }

  return {
    createPendingAuth,
    readPendingAuth,
    consumePendingAuth,
    deletePendingAuth,
    deletePendingAuthForUser,
    deleteExpired,
    clearPendingAuth,
  };
}

const pendingAuthStore = createPendingAuthStore();

export const createPendingAuth = pendingAuthStore.createPendingAuth;
export const readPendingAuth = pendingAuthStore.readPendingAuth;
export const consumePendingAuth = pendingAuthStore.consumePendingAuth;
export const deletePendingAuth = pendingAuthStore.deletePendingAuth;
export const deletePendingAuthForUser = pendingAuthStore.deletePendingAuthForUser;
export const deleteExpiredPendingAuth = pendingAuthStore.deleteExpired;
export const clearPendingAuth = pendingAuthStore.clearPendingAuth;
