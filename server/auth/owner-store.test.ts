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
    for (const migration of ["001_ea_tables.sql", "012_passkey_auth.sql", "030_owner_bootstrap.sql", "031_auth_recovery.sql", "032_canonical_url.sql", "038_auth_security_generation.sql"]) {
      await db.executeMultiple(readFileSync(join(__dirname, `../db/migrations/${migration}`), "utf8"));
    }
  });

  it("defaults to password-or-passkey and updates security fields explicitly", async () => {
    const store = createOwnerStore(db);
    await store.claimOwner({ userId: "owner-a", passwordHash: "hash-a", claimedAt: 100 });

    await expect(store.setAuthMode("owner-a", "password_plus_passkey")).resolves.toBe(true);
    await expect(store.updatePasswordHash("owner-a", "hash-b")).resolves.toBe(true);
    await expect(store.getOwner()).resolves.toMatchObject({
      authMode: "password_plus_passkey",
      passwordHash: "hash-b",
      securityGeneration: 1,
    });
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

  it("persists initial recovery hashes in the same winning claim transaction", async () => {
    const store = createOwnerStore(db);
    await expect(store.claimOwner({
      userId: "owner-a",
      passwordHash: "hash-a",
      claimedAt: 100,
      recoveryCodeHashes: ["sha256:first", "sha256:second"],
    })).resolves.toEqual({ claimed: true });

    const rows = await db.execute("SELECT code_hash FROM ea_owner_recovery_codes ORDER BY code_hash");
    expect(rows.rows.map((row) => row.code_hash)).toEqual(["sha256:first", "sha256:second"]);
  });

  it("persists the confirmed canonical origin in the winning claim transaction", async () => {
    const store = createOwnerStore(db);
    await db.execute(`INSERT INTO ea_instance_metadata
      (singleton_id, canonical_origin, source, confirmed_at, updated_at)
      VALUES (1, 'https://stale.example.com', 'legacy_import', 50, 50)`);
    await expect(store.claimOwner({
      userId: "owner-a",
      passwordHash: "hash-a",
      claimedAt: 100,
      canonicalOrigin: "https://setpoint.example.com",
    })).resolves.toEqual({ claimed: true });

    expect((await db.execute("SELECT canonical_origin, source FROM ea_instance_metadata")).rows)
      .toEqual([{ canonical_origin: "https://setpoint.example.com", source: "owner_confirmed" }]);
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
