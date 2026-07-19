import crypto from "crypto";
import db from "../db/connection.ts";
import type { Client, Row } from "@libsql/client";

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_HASH_PREFIX = "sha256:";
export type WebAuthnChallengeType = "authentication" | "registration";
const VALID_CHALLENGE_TYPES = new Set<WebAuthnChallengeType>(["authentication", "registration"]);

export type StoredWebAuthnChallenge = {
  challengeHash: string;
  userId: string;
  challengeType: WebAuthnChallengeType;
  pendingAuthHash: string | null;
  credentialId: string | null;
  createdAt: number;
  expiresAt: number;
};

type CreateChallengeInput = Partial<{
  userId: string;
  challengeType: WebAuthnChallengeType;
  pendingAuthHash: string | null;
  credentialId: string | null;
  now: number;
  ttlMs: number;
  challenge: string;
}>;

export function hashWebAuthnChallenge(raw: unknown) {
  return CHALLENGE_HASH_PREFIX + crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

function assertChallengeType(type: unknown): asserts type is WebAuthnChallengeType {
  if (typeof type !== "string" || !VALID_CHALLENGE_TYPES.has(type as WebAuthnChallengeType)) {
    throw new Error(`Unsupported WebAuthn challenge type: ${type}`);
  }
}

function mapChallenge(row: Row | undefined): StoredWebAuthnChallenge | null {
  if (!row) return null;
  return {
    challengeHash: String(row.challenge_hash || ""),
    userId: String(row.user_id || ""),
    challengeType: String(row.challenge_type) as WebAuthnChallengeType,
    pendingAuthHash: row.pending_auth_hash ? String(row.pending_auth_hash) : null,
    credentialId: row.credential_id ? String(row.credential_id) : null,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

export function createWebAuthnChallengeStore(database: Client = db) {
  async function deleteExpired(now = Date.now()) {
    await database.execute({
      sql: "DELETE FROM ea_webauthn_challenges WHERE expires_at <= ?",
      args: [now],
    });
  }

  async function createChallenge({
    userId,
    challengeType,
    pendingAuthHash = null,
    credentialId = null,
    now = Date.now(),
    ttlMs = WEBAUTHN_CHALLENGE_TTL_MS,
    challenge,
  }: CreateChallengeInput = {}) {
    if (!userId) throw new Error("userId is required");
    assertChallengeType(challengeType);
    const rawChallenge = challenge || crypto.randomBytes(32).toString("base64url");
    const challengeHash = hashWebAuthnChallenge(rawChallenge);
    const expiresAt = now + ttlMs;
    await deleteExpired(now);
    await database.execute({
      sql: `INSERT INTO ea_webauthn_challenges
              (challenge_hash, user_id, challenge_type, pending_auth_hash, credential_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [challengeHash, userId, challengeType, pendingAuthHash, credentialId, now, expiresAt],
    });
    return {
      challenge: rawChallenge,
      challengeHash,
      userId,
      challengeType,
      pendingAuthHash,
      credentialId,
      createdAt: now,
      expiresAt,
    };
  }

  async function consumeChallenge(
    rawChallenge: string | null | undefined,
    { userId, challengeType, now = Date.now() }: {
      userId?: string;
      challengeType?: WebAuthnChallengeType;
      now?: number;
    } = {},
  ) {
    if (!rawChallenge) return null;
    if (challengeType) assertChallengeType(challengeType);
    const challengeHash = hashWebAuthnChallenge(rawChallenge);
    const result = await database.execute({
      sql: "SELECT * FROM ea_webauthn_challenges WHERE challenge_hash = ?",
      args: [challengeHash],
    });
    const row = result.rows[0];
    if (!row) return null;

    await database.execute({
      sql: "DELETE FROM ea_webauthn_challenges WHERE challenge_hash = ?",
      args: [challengeHash],
    });

    if (Number(row.expires_at) <= now) return null;
    if (userId && row.user_id !== userId) return null;
    if (challengeType && row.challenge_type !== challengeType) return null;
    return mapChallenge(row);
  }

  async function clearChallenges() {
    await database.execute("DELETE FROM ea_webauthn_challenges");
  }

  async function deleteChallengesForPendingAuth(pendingAuthHash: string | null | undefined) {
    if (!pendingAuthHash) return;
    await database.execute({
      sql: "DELETE FROM ea_webauthn_challenges WHERE pending_auth_hash = ?",
      args: [pendingAuthHash],
    });
  }

  return {
    createChallenge,
    consumeChallenge,
    deleteExpired,
    clearChallenges,
    deleteChallengesForPendingAuth,
  };
}

const challengeStore = createWebAuthnChallengeStore();

export const createChallenge = challengeStore.createChallenge;
export const consumeChallenge = challengeStore.consumeChallenge;
export const clearChallenges = challengeStore.clearChallenges;
export const deleteChallengesForPendingAuth = challengeStore.deleteChallengesForPendingAuth;
