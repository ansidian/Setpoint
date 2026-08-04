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
  return { service, credentialService, dbClient, getRow: () => row };
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

  it("uses one narrow authoritative database read per verification", async () => {
    const { service, dbClient } = makeHarness({ GMAIL_PUBSUB_PUSH_TOKEN: "legacy-secret" });

    await expect(service.verifyToken("legacy-secret")).resolves.toBe(true);

    // test-architecture: allow-boundary-interaction -- Token verification is an authorization database boundary; every delivery must perform exactly one authoritative read with no cache window.
    expect(dbClient.execute).toHaveBeenCalledTimes(1);
    const statement = dbClient.execute.mock.calls[0]?.[0];
    expect(statement).toMatchObject({ args: [] });
    const sql = typeof statement === "string" ? statement : statement?.sql ?? "";
    // The selected columns are the callback authorization contract: status and
    // watch diagnostics must not add payload or duplicate reads to this hot path.
    expect(sql.replace(/\s+/g, " ").trim()).toBe(
      "SELECT push_token_hash, token_disabled FROM ea_gmail_pubsub_config WHERE singleton_id = 1",
    );
  });

  it("keeps the authoritative read when rejecting a missing candidate", async () => {
    const { service, dbClient } = makeHarness();

    await expect(service.verifyToken("")).resolves.toBe(false);

    // test-architecture: allow-boundary-interaction -- Token verification is an authorization database boundary; even an empty candidate must perform the one authoritative revocation read.
    expect(dbClient.execute).toHaveBeenCalledTimes(1);
  });

  it("reads token and watch status once when projecting configuration status", async () => {
    const { service, dbClient } = makeHarness();

    await service.getStatus();

    const configReads = dbClient.execute.mock.calls.filter(([statement]) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      return sql.includes("FROM ea_gmail_pubsub_config");
    });
    expect(configReads).toHaveLength(1);
  });

  it("observes token transitions immediately across service instances sharing the database", async () => {
    let row: { push_token_hash: string | null; token_disabled: number } | null = null;
    const dbClient = {
      execute: vi.fn(async (statement: { sql: string; args?: unknown[] }) => {
        if (statement.sql.includes("SELECT push_token_hash")) return { rows: row ? [row] : [] };
        if (statement.sql.includes("INSERT INTO ea_gmail_pubsub_config")) {
          row = {
            push_token_hash: statement.args?.[0] ? String(statement.args[0]) : null,
            token_disabled: Number(statement.args?.[1]),
          };
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL: ${statement.sql}`);
      }),
    };
    const base = makeHarness();
    const createInstance = (token: string) => createGmailPubSubService({
      dbClient: dbClient as never,
      credentialService: base.credentialService as never,
      canonicalUrlResolver: async () => "https://setpoint.example.com/api/gmail/push",
      environment: { GMAIL_PUBSUB_PUSH_TOKEN: "host-token" },
      randomToken: () => token,
    });
    const writer = createInstance("stored-token");
    const verifier = createInstance("unused-token");

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

    await writer.useHostToken();
    await expect(verifier.verifyToken("host-token")).resolves.toBe(true);
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
