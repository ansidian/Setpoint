import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createOwnerStore } from "./owner-store.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("owner store", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    const sql = readFileSync(join(__dirname, "../db/migrations/030_owner_bootstrap.sql"), "utf8");
    await db.executeMultiple(sql);
  });

  afterEach(() => db.close());

  it("reports a fresh instance as unclaimed", async () => {
    const store = createOwnerStore(db);

    await expect(store.getOwner()).resolves.toBeNull();
  });

  it("allows exactly one concurrent singleton claim", async () => {
    const store = createOwnerStore(db);

    const results = await Promise.all([
      store.claimOwner({ userId: "owner-a", passwordHash: "hash-a", claimedAt: 100 }),
      store.claimOwner({ userId: "owner-b", passwordHash: "hash-b", claimedAt: 101 }),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => !result.claimed)).toHaveLength(1);
    const owner = await store.getOwner();
    expect(owner).toMatchObject({ singletonId: 1, claimedAt: expect.any(Number) });
    expect(["owner-a", "owner-b"]).toContain(owner?.userId);
  });

  it("never mutates the owner after the singleton is claimed", async () => {
    const store = createOwnerStore(db);
    await store.claimOwner({ userId: "owner-a", passwordHash: "hash-a", claimedAt: 100 });

    await expect(store.claimOwner({ userId: "owner-b", passwordHash: "hash-b", claimedAt: 101 }))
      .resolves.toEqual({ claimed: false });
    await expect(store.getOwner()).resolves.toMatchObject({
      userId: "owner-a",
      passwordHash: "hash-a",
      claimedAt: 100,
    });
  });
});
