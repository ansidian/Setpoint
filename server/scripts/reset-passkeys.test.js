import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb, seedSession } from "../test-utils/auth-db.ts";
import { createPasskeyStore } from "../auth/passkey-store.js";
import { createPendingAuthStore } from "../auth/pending-auth-store.js";
import { createWebAuthnChallengeStore } from "../auth/webauthn-challenge-store.js";
import { parseArgs, runPasskeyReset } from "./reset-passkeys.js";

describe("reset passkeys script", () => {
  let db = null;

  beforeEach(async () => {
    db = await createAuthTestDb();
  });

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("defaults to dry-run mode unless explicitly confirmed", () => {
    expect(parseArgs([])).toEqual({ confirm: false, dryRun: true });
    expect(parseArgs(["--confirm"])).toEqual({ confirm: true, dryRun: false });
    expect(() => parseArgs(["--confirm", "--dry-run"])).toThrow(/either --confirm or --dry-run/);
  });

  it("reports reset counts in dry-run mode without deleting rows", async () => {
    await seedResetRows(db);

    await expect(runPasskeyReset(db, { dryRun: true })).resolves.toMatchObject({
      dryRun: true,
      counts: {
        ea_passkey_credentials: 1,
        ea_pending_auth: 1,
        ea_webauthn_challenges: 1,
        ea_sessions: 1,
      },
    });

    await expect(tableCount(db, "ea_passkey_credentials")).resolves.toBe(1);
  });

  it("clears passkeys, pending auth, challenges, and sessions when confirmed", async () => {
    await seedResetRows(db);

    await runPasskeyReset(db, { confirm: true, dryRun: false });

    await expect(tableCount(db, "ea_passkey_credentials")).resolves.toBe(0);
    await expect(tableCount(db, "ea_pending_auth")).resolves.toBe(0);
    await expect(tableCount(db, "ea_webauthn_challenges")).resolves.toBe(0);
    await expect(tableCount(db, "ea_sessions")).resolves.toBe(0);
  });
});

async function seedResetRows(db) {
  await createPasskeyStore(db).createPasskey({
    userId: "user-1",
    credentialId: "credential-1",
    label: "Security Key",
    publicKey: "public-key",
  });
  await createPendingAuthStore(db).createPendingAuth({
    userId: "user-1",
    token: "pending-token",
  });
  await createWebAuthnChallengeStore(db).createChallenge({
    userId: "user-1",
    challengeType: "authentication",
    challenge: "challenge",
  });
  await seedSession(db, "cookie-session");
}

async function tableCount(db, table) {
  const result = await db.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count || 0);
}
