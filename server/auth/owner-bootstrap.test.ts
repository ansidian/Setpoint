import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcrypt";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createOwnerStore } from "./owner-store.ts";
import { resolveOwnerBootstrap } from "./owner-bootstrap.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("owner bootstrap", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    for (const migration of [
      "001_ea_tables.sql",
      "012_passkey_auth.sql",
      "030_owner_bootstrap.sql",
      "031_auth_recovery.sql",
      "038_auth_security_generation.sql",
    ]) {
      await db.executeMultiple(readFileSync(join(__dirname, `../db/migrations/${migration}`), "utf8"));
    }
  });

  afterEach(() => db.close());

  it("leaves an instance unclaimed when no legacy identity exists", async () => {
    const result = await resolveOwnerBootstrap({
      store: createOwnerStore(db),
      env: {},
    });

    expect(result).toEqual({ claimed: false, owner: null, source: "unclaimed" });
  });

  it("imports the exact legacy user id and bcrypt hash", async () => {
    const passwordHash = bcrypt.hashSync("existing password", 4);
    const result = await resolveOwnerBootstrap({
      store: createOwnerStore(db),
      env: { EA_USER_ID: "legacy-owner", EA_PASSWORD_HASH: passwordHash },
      now: () => 123,
    });

    expect(result).toMatchObject({
      claimed: true,
      source: "legacy_import",
      owner: { userId: "legacy-owner", passwordHash, claimedAt: 123 },
    });
  });

  it.each([
    { EA_USER_ID: "legacy-owner" },
    { EA_PASSWORD_HASH: bcrypt.hashSync("existing password", 4) },
  ])("fails closed for partial legacy state", async (env) => {
    await expect(resolveOwnerBootstrap({ store: createOwnerStore(db), env }))
      .rejects.toThrow("Legacy owner configuration is incomplete");
  });

  it("fails closed when legacy state conflicts with the stored owner", async () => {
    const store = createOwnerStore(db);
    await store.claimOwner({
      userId: "stored-owner",
      passwordHash: bcrypt.hashSync("stored password", 4),
      claimedAt: 100,
    });

    await expect(resolveOwnerBootstrap({
      store,
      env: {
        EA_USER_ID: "different-owner",
        EA_PASSWORD_HASH: bcrypt.hashSync("different password", 4),
      },
    })).rejects.toThrow("Legacy owner configuration conflicts with the stored owner");
  });
});
