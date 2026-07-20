import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import { createPasskeyStore } from "../auth/passkey-store.ts";
import { createPendingAuthStore } from "../auth/pending-auth-store.ts";
import { createWebAuthnChallengeStore } from "../auth/webauthn-challenge-store.ts";
import { parseArgs, runPasskeyReset } from "./reset-passkeys.ts";
import type { Client } from "@libsql/client";

describe("reset passkeys script", () => {
  let db: Client | null = null;

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
    if (!db) throw new Error("Test DB was not initialized");
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
    if (!db) throw new Error("Test DB was not initialized");
    await seedResetRows(db);

    await runPasskeyReset(db, { confirm: true, dryRun: false });

    await expect(tableCount(db, "ea_passkey_credentials")).resolves.toBe(0);
    await expect(tableCount(db, "ea_pending_auth")).resolves.toBe(0);
    await expect(tableCount(db, "ea_webauthn_challenges")).resolves.toBe(0);
    await expect(tableCount(db, "ea_sessions")).resolves.toBe(0);
    expect((await db.execute("SELECT auth_mode, security_generation FROM ea_owner")).rows)
      .toEqual([{ auth_mode: "password_or_passkey", security_generation: 2 }]);
  });
});

async function seedResetRows(db: Client) {
  await seedOwner(db, { passwordHash: "hash" });
  await db.execute("UPDATE ea_owner SET auth_mode = 'password_plus_passkey'");
  await createPasskeyStore(db).createPasskey({
    userId: "user-1",
    credentialId: "credential-1",
    label: "Security Key",
    publicKey: "public-key",
  });
  await createPendingAuthStore(db).createPendingAuth({
    userId: "user-1",
    token: "pending-token",
    securityGeneration: 1,
  });
  await createWebAuthnChallengeStore(db).createChallenge({
    userId: "user-1",
    challengeType: "authentication",
    challenge: "challenge",
    securityGeneration: 1,
  });
  await seedSession(db, "cookie-session");
}

async function tableCount(db: Client, table: string) {
  const result = await db.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count || 0);
}
