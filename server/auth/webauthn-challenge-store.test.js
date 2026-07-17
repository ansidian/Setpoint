import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb } from "../test-utils/auth-db.ts";
import {
  createWebAuthnChallengeStore,
  hashWebAuthnChallenge,
} from "./webauthn-challenge-store.js";

describe("WebAuthn challenge store", () => {
  let db = null;
  let store = null;

  beforeEach(async () => {
    db = await createAuthTestDb();
    store = createWebAuthnChallengeStore(db);
  });

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("stores only hashed challenge values", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      pendingAuthHash: "sha256:pending",
      challenge: "raw-challenge",
      now: 2_000,
    });

    const rows = await db.execute("SELECT * FROM ea_webauthn_challenges");
    expect(rows.rows[0]).toMatchObject({
      challenge_hash: hashWebAuthnChallenge("raw-challenge"),
      user_id: "user-1",
      challenge_type: "authentication",
      pending_auth_hash: "sha256:pending",
      expires_at: 302_000,
    });
    expect(rows.rows[0].challenge_hash).not.toBe("raw-challenge");
  });

  it("consumes valid challenges exactly once", async () => {
    await store.createChallenge({
      userId: "user-1",
      challengeType: "registration",
      credentialId: "credential-1",
      challenge: "registration-challenge",
      now: 1_000,
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
    });

    await expect(store.consumeChallenge("expired-challenge", {
      userId: "user-1",
      challengeType: "authentication",
      now: 1_101,
    })).resolves.toBeNull();

    const rows = await db.execute("SELECT challenge_hash FROM ea_webauthn_challenges");
    expect(rows.rows).toHaveLength(0);
  });
});
