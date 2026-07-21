import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createAuthTestDb, hashApiToken, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import { createPendingAuthStore } from "./pending-auth-store.ts";
import { createWebAuthnChallengeStore } from "./webauthn-challenge-store.ts";
import { createOwnerSecurityTransitionService } from "./security-transition.ts";

describe("owner security transitions", () => {
  let db: Client;

  beforeEach(async () => {
    db = await createAuthTestDb();
    await seedOwner(db, { passwordHash: "old-hash" });
  });

  afterEach(() => db.close());

  it("atomically mutates owner security state, increments generation, and revokes auth state", async () => {
    await seedSession(db, "old-session", Date.now() + 60_000, Date.now());
    await createPendingAuthStore(db).createPendingAuth({ userId: "user-1", token: "pending", securityGeneration: 1 });
    await createWebAuthnChallengeStore(db).createChallenge({
      userId: "user-1",
      challengeType: "authentication",
      challenge: "challenge",
      securityGeneration: 1,
    });
    await db.execute({
      sql: `INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at)
            VALUES (?, 'Phone', '["actual:write"]', 1, 9999999999999)`,
      args: [hashApiToken("token")],
    });

    const service = createOwnerSecurityTransitionService(db);
    const nextGeneration = await service.transition({
      userId: "user-1",
      expectedGeneration: 1,
      revokeApiTokens: true,
      mutate: async (tx) => {
        await tx.execute({
          sql: "UPDATE ea_owner SET password_hash = ? WHERE singleton_id = 1",
          args: ["new-hash"],
        });
      },
    });

    expect(nextGeneration).toBe(2);
    expect((await db.execute("SELECT password_hash, security_generation FROM ea_owner")).rows)
      .toEqual([{ password_hash: "new-hash", security_generation: 2 }]);
    expect((await db.execute("SELECT * FROM ea_sessions")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_pending_auth")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_webauthn_challenges")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_api_tokens")).rows).toEqual([]);
  });

  it("rejects a stale generation without running the mutation", async () => {
    const service = createOwnerSecurityTransitionService(db);
    let mutated = false;

    await expect(service.transition({
      userId: "user-1",
      expectedGeneration: 0,
      mutate: async () => { mutated = true; },
    })).resolves.toBeNull();

    expect(mutated).toBe(false);
    expect((await db.execute("SELECT security_generation FROM ea_owner")).rows)
      .toEqual([{ security_generation: 1 }]);
  });

  it("rolls back the generation bump when the mutation fails", async () => {
    const service = createOwnerSecurityTransitionService(db);

    await expect(service.transition({
      userId: "user-1",
      expectedGeneration: 1,
      mutate: async () => { throw new Error("mutation failed"); },
    })).rejects.toThrow("mutation failed");

    expect((await db.execute("SELECT security_generation FROM ea_owner")).rows)
      .toEqual([{ security_generation: 1 }]);
  });
});
