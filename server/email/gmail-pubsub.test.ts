import { describe, expect, it, vi } from "vitest";
import { createGmailPubSubService, hashGmailPushToken } from "./gmail-pubsub.ts";

function makeHarness(environment: Record<string, string | undefined> = {}) {
  let row: { push_token_hash: string | null; token_disabled: number } | null = null;
  const dbClient = {
    execute: vi.fn(async (statement: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args ?? [];
      if (sql.includes("SELECT push_token_hash")) return { rows: row ? [row] : [] };
      if (sql.includes("INSERT INTO ea_gmail_pubsub_config")) {
        row = { push_token_hash: args[0] ? String(args[0]) : null, token_disabled: Number(args[1]) };
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("FROM ea_accounts")) return { rows: [] };
      if (sql.includes("FROM ea_gmail_watch_state")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
  const credentialService = {
    resolve: vi.fn(async () => ({ key: "gmail.pubsub_topic", source: "absent", value: null })),
    stagePending: vi.fn(),
    promotePending: vi.fn(),
    importEnvironment: vi.fn(),
    disable: vi.fn(),
    useHostValue: vi.fn(),
  };
  const service = createGmailPubSubService({
    dbClient: dbClient as never,
    credentialService: credentialService as never,
    canonicalUrlResolver: async () => "https://setpoint.example.com/api/gmail/push",
    environment,
    randomToken: () => "generated-once",
  });
  return { service, credentialService, getRow: () => row };
}

describe("Gmail Pub/Sub configuration", () => {
  it("stores only a hash and reveals the generated callback once", async () => {
    const { service, getRow } = makeHarness();

    const generated = await service.generateCallback();

    expect(generated.callbackUrl).toBe("https://setpoint.example.com/api/gmail/push?token=generated-once");
    expect(JSON.stringify(getRow())).not.toContain("generated-once");
    expect(getRow()?.push_token_hash).toBe(hashGmailPushToken("generated-once"));
    expect((await service.getStatus()).callbackUrl).toBe("https://setpoint.example.com/api/gmail/push");
  });

  it("invalidates the previous token immediately when regenerated", async () => {
    const tokens = ["first-token", "second-token"];
    const harness = makeHarness();
    let index = 0;
    const rows = new Map<string, unknown>();
    const dbClient = {
      execute: vi.fn(async (statement: { sql: string; args?: unknown[] }) => {
        if (statement.sql.includes("SELECT push_token_hash")) {
          return { rows: rows.size ? [{ push_token_hash: rows.get("hash"), token_disabled: 0 }] : [] };
        }
        rows.set("hash", statement.args?.[0]);
        return { rows: [], rowsAffected: 1 };
      }),
    };
    const rotating = createGmailPubSubService({
      dbClient: dbClient as never,
      credentialService: harness.credentialService as never,
      canonicalUrlResolver: async () => "https://setpoint.example.com/api/gmail/push",
      randomToken: () => tokens[index++]!,
      environment: {},
    });
    await rotating.generateCallback();
    expect(await rotating.verifyToken("first-token")).toBe(true);
    await rotating.generateCallback();
    expect(await rotating.verifyToken("first-token")).toBe(false);
    expect(await rotating.verifyToken("second-token")).toBe(true);
  });

  it("imports an environment token as a hash without returning plaintext and supports revocation", async () => {
    const { service, getRow } = makeHarness({ GMAIL_PUBSUB_PUSH_TOKEN: "legacy-secret" });

    const imported = await service.importEnvironmentToken();
    expect(JSON.stringify(imported)).not.toContain("legacy-secret");
    expect(getRow()?.push_token_hash).toBe(hashGmailPushToken("legacy-secret"));
    expect(await service.verifyToken("legacy-secret")).toBe(true);

    await service.revokeToken();
    expect(await service.verifyToken("legacy-secret")).toBe(false);
  });

  it("reports periodic reconciliation as healthy degraded behavior when Pub/Sub is absent", async () => {
    const { service } = makeHarness();
    await expect(service.getStatus()).resolves.toMatchObject({
      configured: false,
      deliveryMode: "periodic",
      healthy: true,
      delayedUpdates: true,
    });
  });
});
