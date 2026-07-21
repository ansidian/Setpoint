import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { createEncryption } from "./encryption.ts";
import { createInstanceCredentialService } from "./instance-credential-service.ts";
import { createInstanceCredentialStore } from "./instance-credential-store.ts";

const ROOT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const migrationSql = ["033_instance_credentials.sql", "040_pending_credential_lifecycle.sql"]
  .map((file) => readFileSync(path.join(process.cwd(), "server/db/migrations", file), "utf8"))
  .join("\n");

describe("instance credential service", () => {
  let db: Client;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestTempDir("credential-service-");
    db = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    await db.executeMultiple(migrationSql);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(tempDir);
  });

  function createService(environment: Record<string, string | undefined>, now: () => number = Date.now) {
    return createInstanceCredentialService({
      store: createInstanceCredentialStore(db),
      environment,
      encryption: createEncryption(() => ROOT_KEY),
      now,
    });
  }

  it("resolves stored first, then disablement, then approved env fallback", async () => {
    const service = createService({
      EA_ENCRYPTION_KEY: ROOT_KEY,
      OPENAI_API_KEY: "host-value",
    });
    expect(await service.resolve("ai.openai_api_key")).toEqual({
      key: "ai.openai_api_key",
      source: "environment",
      value: "host-value",
    });

    const staged = await service.stagePending("ai.openai_api_key", "candidate-value");
    expect(staged).not.toHaveProperty("value");
    expect((await service.resolve("ai.openai_api_key")).source).toBe("environment");
    await service.promotePending("ai.openai_api_key", staged.version!);
    expect(await service.resolve("ai.openai_api_key")).toEqual({
      key: "ai.openai_api_key",
      source: "stored",
      value: "candidate-value",
    });

    await service.disable("ai.openai_api_key");
    expect(await service.resolve("ai.openai_api_key")).toEqual({
      key: "ai.openai_api_key",
      source: "disabled",
      value: null,
    });
    const disabledCandidate = await service.stagePending("ai.openai_api_key", "new-candidate");
    expect((await service.resolve("ai.openai_api_key")).source).toBe("disabled");
    await service.promotePending("ai.openai_api_key", disabledCandidate.version!);
    expect(await service.resolve("ai.openai_api_key")).toMatchObject({
      source: "stored",
      value: "new-candidate",
    });
    await service.disable("ai.openai_api_key");
    await service.useHostValue("ai.openai_api_key");
    expect((await service.resolve("ai.openai_api_key")).source).toBe("environment");
  });

  it("imports an env-backed value without returning plaintext and emits invalidation events", async () => {
    const service = createService({
      EA_ENCRYPTION_KEY: ROOT_KEY,
      PIRATE_WEATHER_API_KEY: "weather-secret",
    });
    const listener = vi.fn();
    service.subscribe(listener);

    const metadata = await service.importEnvironment("weather.pirate_weather_api_key");
    expect(metadata).toMatchObject({ source: "stored", activeConfigured: true });
    expect(JSON.stringify(metadata)).not.toContain("weather-secret");
    expect(listener).toHaveBeenCalledWith({
      key: "weather.pirate_weather_api_key",
      reason: "environment_imported",
    });
  });

  it("does not delete a stored value when host fallback is unavailable", async () => {
    const service = createService({ EA_ENCRYPTION_KEY: ROOT_KEY });
    const staged = await service.stagePending("ai.openai_api_key", "stored-secret");
    await service.promotePending("ai.openai_api_key", staged.version!);

    await expect(service.useHostValue("ai.openai_api_key")).rejects.toMatchObject({
      code: "HOST_CREDENTIAL_UNAVAILABLE",
      status: 409,
    });
    await expect(service.resolve("ai.openai_api_key")).resolves.toMatchObject({
      source: "stored",
      value: "stored-secret",
    });
  });

  it("validates every host value before atomically changing a credential group", async () => {
    const service = createService({
      EA_ENCRYPTION_KEY: ROOT_KEY,
      GOOGLE_CLIENT_ID: "host-client-id",
    });
    const staged = await service.stagePendingGroup([
      { key: "google.oauth_client_id", value: "stored-client-id" },
      { key: "google.oauth_client_secret", value: "stored-client-secret" },
    ]);
    await service.promotePendingGroup(staged.map((item) => ({
      key: item.key,
      expectedVersion: item.version!,
    })));

    await expect(service.useHostValueGroup([
      "google.oauth_client_id",
      "google.oauth_client_secret",
    ])).rejects.toMatchObject({ code: "HOST_CREDENTIAL_UNAVAILABLE" });
    await expect(service.resolve("google.oauth_client_id")).resolves.toMatchObject({
      source: "stored",
      value: "stored-client-id",
    });
    await expect(service.resolve("google.oauth_client_secret")).resolves.toMatchObject({
      source: "stored",
      value: "stored-client-secret",
    });
  });

  it("rejects unknown keys before reading or writing storage", async () => {
    const service = createService({ EA_ENCRYPTION_KEY: ROOT_KEY });
    await expect(service.resolve("arbitrary.secret")).rejects.toMatchObject({
      code: "UNKNOWN_INSTANCE_CREDENTIAL",
      status: 404,
    });
  });

  it("reports root-key validity and decryptability without exposing key material", async () => {
    const service = createService({ EA_ENCRYPTION_KEY: ROOT_KEY });
    const metadata = await service.getMetadata();
    expect(metadata.rootKey).toEqual({
      configured: true,
      valid: true,
      fingerprint: expect.stringMatching(/^sha256:/),
      decryptability: "ok",
    });
    expect(JSON.stringify(metadata)).not.toContain(ROOT_KEY);
  });

  it("projects one credential's availability without returning its value", async () => {
    const service = createService({
      EA_ENCRYPTION_KEY: ROOT_KEY,
      ANTHROPIC_API_KEY: "host-anthropic-secret",
    });
    const metadata = await service.getCredentialMetadata("ai.anthropic_api_key");
    expect(metadata).toMatchObject({ source: "environment", activeConfigured: true });
    expect(metadata.capabilities).toEqual(["email_triage", "bill_extraction", "alfred"]);
    expect(JSON.stringify(metadata)).not.toContain("host-anthropic-secret");
  });

  it("never reads, promotes, or exposes metadata for an expired pending value", async () => {
    let currentTime = 100;
    const service = createService({ EA_ENCRYPTION_KEY: ROOT_KEY }, () => currentTime);
    const staged = await service.stagePending("ai.openai_api_key", "candidate-secret");
    expect(staged).toMatchObject({
      pendingStagedAt: 100,
      pendingExpiresAt: 100 + 86_400_000,
    });
    expect(JSON.stringify(staged)).not.toContain("candidate-secret");

    currentTime = 100 + 86_400_000;
    await expect(service.readPending("ai.openai_api_key")).resolves.toBeNull();
    await expect(service.promotePending("ai.openai_api_key", staged.version!))
      .rejects.toMatchObject({ code: "INSTANCE_CREDENTIAL_CONFLICT" });
    expect(await service.getCredentialMetadata("ai.openai_api_key")).toMatchObject({
      pendingConfigured: false,
      pendingStagedAt: null,
      pendingExpiresAt: null,
    });
  });

  it("discards a candidate by version while preserving the active credential", async () => {
    let currentTime = 10;
    const service = createService({ EA_ENCRYPTION_KEY: ROOT_KEY }, () => currentTime);
    const first = await service.stagePending("ai.openai_api_key", "active-value");
    await service.promotePending("ai.openai_api_key", first.version!);
    currentTime = 20;
    const pending = await service.stagePending("ai.openai_api_key", "discard-me");
    const metadata = await service.discardPending("ai.openai_api_key", pending.version!);

    expect(metadata).toMatchObject({ activeConfigured: true, pendingConfigured: false });
    expect(await service.resolve("ai.openai_api_key")).toMatchObject({ value: "active-value" });
  });
});
