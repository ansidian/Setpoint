import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGmailPubSubService, hashGmailPushToken } from "./gmail-pubsub.ts";

const migration = readFileSync(new URL("../db/migrations/035_gmail_pubsub_config.sql", import.meta.url), "utf8");
const clients: Client[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function makeHarness(environment: Record<string, string | undefined> = {}) {
  const dbClient = createClient({ url: ":memory:" });
  clients.push(dbClient);
  await dbClient.executeMultiple(migration);
  const credentialService = {
    resolve: vi.fn(async () => ({ key: "gmail.pubsub_topic", source: "absent", value: null })),
  };
  const createInstance = (randomToken = () => "generated-once") => createGmailPubSubService({
    dbClient: dbClient as never,
    credentialService: credentialService as never,
    canonicalUrlResolver: async () => "https://setpoint.example.com/api/gmail/push",
    environment,
    randomToken,
  });
  return { service: createInstance(), createInstance, dbClient };
}

describe("Gmail Pub/Sub configuration", () => {
  it("stores only a hash and reveals the generated callback once", async () => {
    const { service, dbClient } = await makeHarness();

    const generated = await service.generateCallback();
    const { rows } = await dbClient.execute("SELECT * FROM ea_gmail_pubsub_config");

    expect(generated.callbackUrl).toBe("https://setpoint.example.com/api/gmail/push?token=generated-once");
    expect(JSON.stringify(rows)).not.toContain("generated-once");
    expect(rows[0]?.push_token_hash).toBe(hashGmailPushToken("generated-once"));
    expect((await service.getStatus()).callbackUrl).toBe("https://setpoint.example.com/api/gmail/push");
  });

  it("invalidates the previous token immediately when regenerated", async () => {
    const { createInstance } = await makeHarness();
    const tokens = ["first-token", "second-token"];
    let index = 0;
    const service = createInstance(() => tokens[index++]!);

    expect(await service.verifyToken("")).toBe(false);
    expect(await service.verifyToken("first-token")).toBe(false);
    await service.generateCallback();
    expect(await service.verifyToken("first-token")).toBe(true);
    expect(await service.verifyToken("wrong-token")).toBe(false);
    expect(await service.verifyToken("")).toBe(false);
    await service.generateCallback();
    expect(await service.verifyToken("first-token")).toBe(false);
    expect(await service.verifyToken("second-token")).toBe(true);
  });

  it("observes token transitions immediately across service instances sharing the database", async () => {
    const { createInstance } = await makeHarness({ GMAIL_PUBSUB_PUSH_TOKEN: "host-token" });
    const writer = createInstance(() => "stored-token");
    const verifier = createInstance(() => "unused-token");

    await writer.generateCallback();
    await expect(verifier.verifyToken("stored-token")).resolves.toBe(true);

    await writer.importEnvironmentToken();
    await expect(verifier.verifyToken("stored-token")).resolves.toBe(false);
    await expect(verifier.verifyToken("host-token")).resolves.toBe(true);

    await writer.generateCallback();
    await expect(verifier.verifyToken("host-token")).resolves.toBe(false);
    await expect(verifier.verifyToken("stored-token")).resolves.toBe(true);

    await writer.revokeToken();
    await expect(verifier.verifyToken("stored-token")).resolves.toBe(false);
    await expect(verifier.verifyToken("host-token")).resolves.toBe(false);

    await writer.useHostToken();
    await expect(verifier.verifyToken("host-token")).resolves.toBe(true);
  });

  it("imports an environment token as a hash without returning plaintext and supports revocation", async () => {
    const { service, dbClient } = await makeHarness({ GMAIL_PUBSUB_PUSH_TOKEN: "legacy-secret" });

    const imported = await service.importEnvironmentToken();
    const { rows } = await dbClient.execute("SELECT * FROM ea_gmail_pubsub_config");
    expect(JSON.stringify(imported)).not.toContain("legacy-secret");
    expect(rows[0]?.push_token_hash).toBe(hashGmailPushToken("legacy-secret"));
    expect(await service.verifyToken("legacy-secret")).toBe(true);

    await service.revokeToken();
    expect(await service.verifyToken("legacy-secret")).toBe(false);
  });

  it("reports periodic reconciliation as healthy degraded behavior when Pub/Sub is absent", async () => {
    const { service } = await makeHarness();
    await expect(service.getStatus()).resolves.toMatchObject({
      configured: false,
      deliveryMode: "periodic",
      healthy: true,
      delayedUpdates: true,
    });
  });
});
