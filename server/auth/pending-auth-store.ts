import crypto from "crypto";
import db from "../db/connection.ts";
import type { Client, Row } from "@libsql/client";
import type { CookieOptions } from "express";

export const PENDING_AUTH_COOKIE_NAME = "ea_pending_auth";
export const PENDING_AUTH_TTL_MS = 5 * 60 * 1000;
const TOKEN_HASH_PREFIX = "sha256:";

export type PendingAuth = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
};

type PendingAuthInput = Partial<{
  userId: string;
  now: number;
  ttlMs: number;
  token: string;
}>;

export function hashPendingAuthToken(raw: unknown) {
  return TOKEN_HASH_PREFIX + crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

export function buildPendingAuthCookieOptions(
  { now = Date.now(), ttlMs = PENDING_AUTH_TTL_MS }: { now?: number; ttlMs?: number } = {},
): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ttlMs,
    expires: new Date(now + ttlMs),
    path: "/",
  };
}

function mapPendingAuth(row: Row | undefined): PendingAuth | null {
  if (!row) return null;
  return {
    tokenHash: String(row.token_hash || ""),
    userId: String(row.user_id || ""),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

export function createPendingAuthStore(database: Client = db) {
  async function deleteExpired(now = Date.now()) {
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE expires_at <= ?",
      args: [now],
    });
  }

  async function createPendingAuth({ userId, now = Date.now(), ttlMs = PENDING_AUTH_TTL_MS, token }: PendingAuthInput = {}) {
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

  async function readPendingAuth(rawToken: string | null | undefined, { now = Date.now() }: { now?: number } = {}) {
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

  async function consumePendingAuth(rawToken: string | null | undefined, { now = Date.now() }: { now?: number } = {}) {
    const pendingAuth = await readPendingAuth(rawToken, { now });
    if (!pendingAuth) return null;
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE token_hash = ?",
      args: [pendingAuth.tokenHash],
    });
    return pendingAuth;
  }

  async function deletePendingAuth(rawToken: string | null | undefined) {
    if (!rawToken) return;
    await database.execute({
      sql: "DELETE FROM ea_pending_auth WHERE token_hash = ?",
      args: [hashPendingAuthToken(rawToken)],
    });
  }

  async function deletePendingAuthForUser(userId: string) {
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
export const clearPendingAuth = pendingAuthStore.clearPendingAuth;
