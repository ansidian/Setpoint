import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  createInstanceCredentialStore,
  InstanceCredentialConflictError,
} from "./instance-credential-store.ts";

const migrationSql = readFileSync(
  path.join(process.cwd(), "server/db/migrations/033_instance_credentials.sql"),
  "utf8",
);

describe("instance credential store", () => {
  let db: Client;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestTempDir("credential-store-");
    db = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    await db.executeMultiple(migrationSql);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(tempDir);
  });

  it("keeps the active value while staging and rejecting a replacement", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActive("ai.openai_api_key", "encrypted-active", 10);
    const pending = await store.stagePending("ai.openai_api_key", "encrypted-candidate", 20);

    const failed = await store.recordPendingFailure(
      "ai.openai_api_key",
      pending.version,
      "PROVIDER_UNAUTHORIZED",
      30,
    );

    expect(failed).toMatchObject({
      activeValueEncrypted: "encrypted-active",
      pendingValueEncrypted: "encrypted-candidate",
      validationState: "invalid",
      errorCode: "PROVIDER_UNAUTHORIZED",
      lastFailedAt: 30,
    });
  });

  it("promotes a pending value atomically and rejects stale concurrent promotion", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActive("ai.openai_api_key", "encrypted-active", 10);
    const pending = await store.stagePending("ai.openai_api_key", "encrypted-candidate", 20);

    const promoted = await store.promotePending("ai.openai_api_key", pending.version, 30);
    expect(promoted).toMatchObject({
      activeValueEncrypted: "encrypted-candidate",
      pendingValueEncrypted: null,
      validationState: "valid",
      lastSucceededAt: 30,
    });
    await expect(
      store.promotePending("ai.openai_api_key", pending.version, 40),
    ).rejects.toBeInstanceOf(InstanceCredentialConflictError);
    expect((await store.get("ai.openai_api_key"))?.activeValueEncrypted).toBe("encrypted-candidate");
  });

  it("stages and promotes a credential group atomically", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActive("google.oauth_client_id", "old-id", 10);
    await store.importActive("google.oauth_client_secret", "old-secret", 10);

    const pending = await store.stagePendingGroup([
      { key: "google.oauth_client_id", encryptedValue: "new-id" },
      { key: "google.oauth_client_secret", encryptedValue: "new-secret" },
    ], 20);
    const versions = pending.map((record) => ({
      key: record.key,
      expectedVersion: record.version,
    }));

    await store.stagePending("google.oauth_client_secret", "newer-secret", 25);
    await expect(store.promotePendingGroup(versions, 30))
      .rejects.toBeInstanceOf(InstanceCredentialConflictError);
    expect(await store.get("google.oauth_client_id")).toMatchObject({
      activeValueEncrypted: "old-id",
      pendingValueEncrypted: "new-id",
    });

    const currentSecret = await store.get("google.oauth_client_secret");
    const promoted = await store.promotePendingGroup([
      versions[0]!,
      { key: "google.oauth_client_secret", expectedVersion: currentSecret!.version },
    ], 40);
    expect(promoted).toEqual([
      expect.objectContaining({ activeValueEncrypted: "new-id", pendingValueEncrypted: null }),
      expect.objectContaining({ activeValueEncrypted: "newer-secret", pendingValueEncrypted: null }),
    ]);
  });

  it("distinguishes explicit disablement from returning to host-managed resolution", async () => {
    const store = createInstanceCredentialStore(db);
    const disabled = await store.disable("weather.pirate_weather_api_key", 10);
    expect(disabled).toMatchObject({ disabled: true, activeValueEncrypted: null });

    await store.useHostValue("weather.pirate_weather_api_key");
    expect(await store.get("weather.pirate_weather_api_key")).toBeNull();
  });

  it("disables and restores a provider-owned credential group in one transaction", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActiveGroup([
      { key: "google.oauth_client_id", encryptedValue: "stored-id" },
      { key: "google.oauth_client_secret", encryptedValue: "stored-secret" },
    ], 10);

    const disabled = await store.disableGroup([
      "google.oauth_client_id",
      "google.oauth_client_secret",
    ], 20);
    expect(disabled).toEqual([
      expect.objectContaining({ key: "google.oauth_client_id", disabled: true, activeValueEncrypted: null }),
      expect.objectContaining({ key: "google.oauth_client_secret", disabled: true, activeValueEncrypted: null }),
    ]);

    await store.useHostValueGroup([
      "google.oauth_client_id",
      "google.oauth_client_secret",
    ]);
    expect(await store.get("google.oauth_client_id")).toBeNull();
    expect(await store.get("google.oauth_client_secret")).toBeNull();
  });

  it("rejects unknown keys at the persistence boundary", async () => {
    const store = createInstanceCredentialStore(db);
    await expect(store.stagePending(
      "arbitrary.secret" as "ai.openai_api_key",
      "encrypted",
    )).rejects.toMatchObject({ code: "UNKNOWN_INSTANCE_CREDENTIAL" });
    expect((await store.list())).toEqual([]);
  });
});
