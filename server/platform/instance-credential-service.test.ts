import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { createEncryption } from "./encryption.ts";
import { createInstanceCredentialService } from "./instance-credential-service.ts";
import { createInstanceCredentialStore } from "./instance-credential-store.ts";

const ROOT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const migrationSql = readFileSync(
  path.join(process.cwd(), "server/db/migrations/033_instance_credentials.sql"),
  "utf8",
);

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

  function createService(environment: Record<string, string | undefined>) {
    return createInstanceCredentialService({
      store: createInstanceCredentialStore(db),
      environment,
      encryption: createEncryption(() => ROOT_KEY),
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
});
