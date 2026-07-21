import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb } from "../test-utils/auth-db.ts";
import {
  createWebAuthnChallengeStore,
  hashWebAuthnChallenge,
} from "./webauthn-challenge-store.ts";
import type { Client } from "@libsql/client";

describe("WebAuthn challenge store", () => {
  let db: Client;
  let store: ReturnType<typeof createWebAuthnChallengeStore>;

  beforeEach(async () => {
    db = await createAuthTestDb();
    store = createWebAuthnChallengeStore(db);
  });

  afterEach(async () => {
    db.close();
  });

  it("stores only hashed challenge values", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: "sha256:pending",
      challenge: "raw-challenge",
      now: 2_000,
      securityGeneration: 1,
    });

    const rows = await db.execute("SELECT * FROM ea_webauthn_challenges");
    expect(rows.rows[0]).toMatchObject({
      challenge_hash: hashWebAuthnChallenge("raw-challenge"),
      user_id: "user-1",
      challenge_type: "authentication",
      pending_auth_hash: "sha256:pending",
      expires_at: 302_000,
      security_generation: 1,
    });
    expect(rows.rows[0]!.challenge_hash).not.toBe("raw-challenge");
  });

  it("consumes valid challenges exactly once", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "registration",
      credentialId: "credential-1",
      challenge: "registration-challenge",
      now: 1_000,
      securityGeneration: 1,
    });

    await expect(store.consumeChallenge("registration-challenge", {
      userId: "user-1",
      challengeType: "registration",
      now: 1_100,
    })).resolves.toMatchObject({
      userId: "user-1",
      challengeType: "registration",
      credentialId: "credential-1",
    });
    await expect(store.consumeChallenge("registration-challenge", {
      userId: "user-1",
      challengeType: "registration",
      now: 1_100,
    })).resolves.toBeNull();
  });

  it("consumes expired or mismatched challenges without returning them", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      challenge: "expired-challenge",
      now: 1_000,
      ttlMs: 100,
      securityGeneration: 1,
    });

    await expect(store.consumeChallenge("expired-challenge", {
      userId: "user-1",
      challengeType: "authentication",
      now: 1_101,
    })).resolves.toBeNull();

    const rows = await db.execute("SELECT challenge_hash FROM ea_webauthn_challenges");
    expect(rows.rows).toHaveLength(0);
  });

  it("allows only one concurrent consumer", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      challenge: "concurrent-challenge",
      now: 1_000,
      securityGeneration: 1,
    });

    const results = await Promise.all([
      store.consumeChallenge("concurrent-challenge", {
        userId: "user-1",
        challengeType: "authentication",
        now: 1_100,
      }),
      store.consumeChallenge("concurrent-challenge", {
        userId: "user-1",
        challengeType: "authentication",
        now: 1_100,
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
