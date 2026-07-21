import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb, seedOwner } from "../test-utils/auth-db.ts";
import {
  createPendingAuthStore,
  hashPendingAuthToken,
} from "./pending-auth-store.ts";
import type { Client } from "@libsql/client";

describe("pending auth store", () => {
  let db: Client;
  let store: ReturnType<typeof createPendingAuthStore>;

  beforeEach(async () => {
    db = await createAuthTestDb();
    await seedOwner(db, { passwordHash: "hash" });
    store = createPendingAuthStore(db);
  });

  afterEach(async () => {
    db.close();
  });

  it("stores only hashed pending auth tokens and reads valid pending auth", async () => {
    const pending = await store.createPendingAuth({
      userId: "user-1",
      token: "raw-pending-token",
      now: 1_000,
      securityGeneration: 1,
      passwordAuthenticatedAt: 900,
      expectedAuthMode: "password_or_passkey",
    });

    const rows = await db.execute(
      "SELECT token_hash, user_id, expires_at, security_generation, password_authenticated_at FROM ea_pending_auth",
    );
    expect(rows.rows[0]).toMatchObject({
      token_hash: hashPendingAuthToken("raw-pending-token"),
      user_id: "user-1",
      expires_at: 301_000,
      security_generation: 1,
      password_authenticated_at: 900,
    });
    expect(rows.rows[0]!.token_hash).not.toBe(pending!.token);

    await expect(store.readPendingAuth("raw-pending-token", { now: 2_000 })).resolves.toMatchObject({
      tokenHash: hashPendingAuthToken("raw-pending-token"),
      userId: "user-1",
      expiresAt: 301_000,
    });
  });

  it("expires and deletes stale pending auth", async () => {
    await store.createPendingAuth({
      userId: "user-1",
      token: "expired-token",
      now: 1_000,
      ttlMs: 100,
      securityGeneration: 1,
    });

    await expect(store.readPendingAuth("expired-token", { now: 1_101 })).resolves.toBeNull();

    const rows = await db.execute("SELECT token_hash FROM ea_pending_auth");
    expect(rows.rows).toHaveLength(0);
  });

  it("consumes pending auth once", async () => {
    await store.createPendingAuth({
      userId: "user-1",
      token: "one-time-token",
      now: 1_000,
      securityGeneration: 1,
    });

    await expect(store.consumePendingAuth("one-time-token", { now: 2_000 })).resolves.toMatchObject({
      userId: "user-1",
    });
    await expect(store.consumePendingAuth("one-time-token", { now: 2_000 })).resolves.toBeNull();
  });

  it("allows only one concurrent consumer", async () => {
    await store.createPendingAuth({
      userId: "user-1",
      token: "concurrent-token",
      now: 1_000,
      securityGeneration: 1,
    });

    const results = await Promise.all([
      store.consumePendingAuth("concurrent-token", { now: 2_000 }),
      store.consumePendingAuth("concurrent-token", { now: 2_000 }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not create pending auth after the expected mode or generation changes", async () => {
    await db.execute("UPDATE ea_owner SET auth_mode = 'password_plus_passkey', security_generation = 2");

    await expect(store.createPendingAuth({
      userId: "user-1",
      securityGeneration: 1,
      expectedAuthMode: "password_or_passkey",
    })).resolves.toBeNull();
    expect((await db.execute("SELECT * FROM ea_pending_auth")).rows).toEqual([]);
  });
});
