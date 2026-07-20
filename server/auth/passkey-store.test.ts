import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthTestDb } from "../test-utils/auth-db.ts";
import { createPasskeyStore } from "./passkey-store.ts";
import type { Client } from "@libsql/client";

describe("passkey store", () => {
  let db: Client;
  let store: ReturnType<typeof createPasskeyStore>;

  beforeEach(async () => {
    db = await createAuthTestDb();
    store = createPasskeyStore(db);
  });

  afterEach(async () => {
    db.close();
  });

  it("creates and lists passkey verification records with safe metadata", async () => {
    const created = await store.createPasskey({
      userId: "user-1",
      credentialId: "credential-1",
      label: "MacBook Touch ID",
      publicKey: "public-key-base64url",
      signCount: 7,
      transports: ["internal", "hybrid"],
      backedUp: true,
      credentialDeviceType: "multiDevice",
      now: 10_000,
    });

    expect(created).toMatchObject({
      credentialId: "credential-1",
      userId: "user-1",
      label: "MacBook Touch ID",
      publicKey: "public-key-base64url",
      signCount: 7,
      transports: ["internal", "hybrid"],
      backedUp: true,
      credentialDeviceType: "multiDevice",
      createdAt: 10_000,
      lastUsedAt: null,
    });

    await expect(store.listPasskeyMetadata("user-1")).resolves.toEqual([
      expect.not.objectContaining({ publicKey: expect.anything() }),
    ]);
  });

  it("updates usage and deletes individual credentials", async () => {
    await store.createPasskey({
      userId: "user-1",
      credentialId: "credential-1",
      label: "Security Key",
      publicKey: "public-key",
      signCount: 1,
      now: 1_000,
    });

    await expect(store.updatePasskeyUsage("credential-1", {
      signCount: 2,
      backedUp: false,
      lastUsedAt: 2_000,
    })).resolves.toMatchObject({
      signCount: 2,
      backedUp: false,
      lastUsedAt: 2_000,
    });

    await expect(store.deletePasskey("credential-1", "user-1")).resolves.toBe(1);
    await expect(store.countPasskeys("user-1")).resolves.toBe(0);
  });

  it("never regresses an authenticator sign counter", async () => {
    await store.createPasskey({
      userId: "user-1",
      credentialId: "credential-1",
      label: "Security Key",
      publicKey: "public-key",
      signCount: 8,
    });

    await store.updatePasskeyUsage("credential-1", { signCount: 7 });

    await expect(store.getPasskeyByCredentialId("credential-1")).resolves.toMatchObject({ signCount: 8 });
  });
});
