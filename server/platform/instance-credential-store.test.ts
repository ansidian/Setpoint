import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  createInstanceCredentialStore,
  InstanceCredentialConflictError,
} from "./instance-credential-store.ts";

const migrationSql = ["033_instance_credentials.sql", "040_pending_credential_lifecycle.sql"]
  .map((file) => readFileSync(path.join(process.cwd(), "server/db/migrations", file), "utf8"))
  .join("\n");

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
    expect((await store.get("ai.openai_api_key", 40))?.activeValueEncrypted).toBe("encrypted-candidate");
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
    expect(await store.get("google.oauth_client_id", 30)).toMatchObject({
      activeValueEncrypted: "old-id",
      pendingValueEncrypted: "new-id",
    });

    const currentSecret = await store.get("google.oauth_client_secret", 30);
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
    expect(await store.get("weather.pirate_weather_api_key", 10)).toBeNull();
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
    expect(await store.get("google.oauth_client_id", 20)).toBeNull();
    expect(await store.get("google.oauth_client_secret", 20)).toBeNull();
  });

  it("rejects unknown keys at the persistence boundary", async () => {
    const store = createInstanceCredentialStore(db);
    await expect(store.stagePending(
      "arbitrary.secret" as "ai.openai_api_key",
      "encrypted",
    )).rejects.toMatchObject({ code: "UNKNOWN_INSTANCE_CREDENTIAL" });
    expect((await store.list())).toEqual([]);
  });

  it("expires candidates at the exact 24-hour boundary without replacing active values", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActive("ai.openai_api_key", "encrypted-active", 10);
    const pending = await store.stagePending("ai.openai_api_key", "encrypted-candidate", 20);

    expect(await store.get("ai.openai_api_key", 20 + 86_400_000 - 1)).toMatchObject({
      pendingValueEncrypted: "encrypted-candidate",
      pendingStagedAt: 20,
      pendingExpiresAt: 20 + 86_400_000,
    });
    expect(await store.get("ai.openai_api_key", 20 + 86_400_000)).toMatchObject({
      activeValueEncrypted: "encrypted-active",
      pendingValueEncrypted: null,
      pendingStagedAt: null,
      pendingExpiresAt: null,
      validationState: "untested",
      errorCode: null,
      version: pending.version + 1,
    });
  });

  it("does not extend candidate expiry when validation state changes", async () => {
    const store = createInstanceCredentialStore(db);
    const pending = await store.stagePending("ai.openai_api_key", "encrypted-candidate", 100);
    const failed = await store.recordPendingFailure(
      "ai.openai_api_key",
      pending.version,
      "PROVIDER_UNAUTHORIZED",
      1_000,
    );

    expect(failed).toMatchObject({
      pendingStagedAt: 100,
      pendingExpiresAt: 100 + 86_400_000,
      updatedAt: 1_000,
    });
    await expect(store.promotePending(
      "ai.openai_api_key",
      failed.version,
      100 + 86_400_000,
    )).rejects.toBeInstanceOf(InstanceCredentialConflictError);
    expect((await store.get("ai.openai_api_key", 100 + 86_400_000))?.pendingValueEncrypted).toBeNull();
  });

  it("lazily prunes every expired candidate and clears provider pairs atomically", async () => {
    const store = createInstanceCredentialStore(db);
    await store.stagePending("ai.openai_api_key", "expired-single", 1);
    await store.stagePendingGroup([
      { key: "google.oauth_client_id", encryptedValue: "expired-id" },
      { key: "google.oauth_client_secret", encryptedValue: "expired-secret" },
    ], 2);
    await store.stagePendingGroup([
      { key: "tasks.todoist_client_id", encryptedValue: "todoist-id" },
      { key: "tasks.todoist_client_secret", encryptedValue: "todoist-secret" },
    ], 86_400_010);

    await store.get("tasks.todoist_client_id", 86_400_002);

    expect((await store.get("ai.openai_api_key", 86_400_002))?.pendingValueEncrypted).toBeNull();
    expect((await store.get("google.oauth_client_id", 86_400_002))?.pendingValueEncrypted).toBeNull();
    expect((await store.get("google.oauth_client_secret", 86_400_002))?.pendingValueEncrypted).toBeNull();
    expect((await store.get("tasks.todoist_client_id", 86_400_002))?.pendingValueEncrypted).toBe("todoist-id");
  });

  it.each([
    ["google.oauth_client_id", "google.oauth_client_secret"],
    ["tasks.todoist_client_id", "tasks.todoist_client_secret"],
  ] as const)("expires the %s pair atomically when only one member has reached expiry", async (firstKey, secondKey) => {
    const store = createInstanceCredentialStore(db);
    await store.stagePendingGroup([
      { key: firstKey, encryptedValue: "first" },
      { key: secondKey, encryptedValue: "second" },
    ], 100);
    await db.execute({
      sql: "UPDATE ea_instance_credentials SET pending_expires_at = ? WHERE credential_key = ?",
      args: [200, firstKey],
    });

    await store.get(firstKey, 200);

    expect((await store.get(firstKey, 200))?.pendingValueEncrypted).toBeNull();
    expect((await store.get(secondKey, 200))?.pendingValueEncrypted).toBeNull();
  });

  it("discards single and grouped candidates only at their expected versions", async () => {
    const store = createInstanceCredentialStore(db);
    await store.importActive("ai.openai_api_key", "active", 1);
    const single = await store.stagePending("ai.openai_api_key", "candidate", 2);
    await expect(store.discardPending("ai.openai_api_key", single.version - 1, 3))
      .rejects.toBeInstanceOf(InstanceCredentialConflictError);
    const discarded = await store.discardPending("ai.openai_api_key", single.version, 3);
    expect(discarded).toMatchObject({ activeValueEncrypted: "active", pendingValueEncrypted: null });

    const pair = await store.stagePendingGroup([
      { key: "google.oauth_client_id", encryptedValue: "id" },
      { key: "google.oauth_client_secret", encryptedValue: "secret" },
    ], 4);
    await expect(store.discardPendingGroup([
      { key: pair[0]!.key, expectedVersion: pair[0]!.version },
      { key: pair[1]!.key, expectedVersion: pair[1]!.version - 1 },
    ], 5)).rejects.toBeInstanceOf(InstanceCredentialConflictError);
    expect((await store.get("google.oauth_client_id", 5))?.pendingValueEncrypted).toBe("id");
    const discardedPair = await store.discardPendingGroup(pair.map((record) => ({
      key: record.key,
      expectedVersion: record.version,
    })), 5);
    expect(discardedPair.every((record) => record.pendingValueEncrypted === null)).toBe(true);
  });
});
