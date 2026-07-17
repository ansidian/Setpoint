import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb } from "../test-utils/auth-db.ts";
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
    });

    const rows = await db.execute("SELECT token_hash, user_id, expires_at FROM ea_pending_auth");
    expect(rows.rows[0]).toMatchObject({
      token_hash: hashPendingAuthToken("raw-pending-token"),
      user_id: "user-1",
      expires_at: 301_000,
    });
    expect(rows.rows[0]!.token_hash).not.toBe(pending.token);

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
    });

    await expect(store.consumePendingAuth("one-time-token", { now: 2_000 })).resolves.toMatchObject({
      userId: "user-1",
    });
    await expect(store.consumePendingAuth("one-time-token", { now: 2_000 })).resolves.toBeNull();
  });
});
