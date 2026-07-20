import { describe, expect, it, vi } from "vitest";
import { createCapabilityStatusService, loadCapabilityEvidence } from "./capability-status-service.ts";

const metadata = [{
    key: "ai.openai_api_key",
    handling: "secret" as const,
    capabilities: ["email_triage"],
    source: "stored" as const,
    activeConfigured: true,
    pendingConfigured: false,
    pendingStagedAt: null,
    pendingExpiresAt: null,
    validationState: "valid" as const,
    lastTestedAt: 100,
    lastSucceededAt: 100,
    lastFailedAt: null,
    errorCode: null,
    version: 1,
  }];

function metadataResolver() {
  return vi.fn(async (key: string) => metadata.find((item) => item.key === key) ?? ({
    ...metadata[0]!, key, source: "absent" as const, activeConfigured: false,
  }));
}

function evidence() {
  return {
    accounts: [{ type: "gmail", needsReauth: false }],
    settings: {
      actualConfigured: false,
      discordConfigured: false,
      todoistConfigured: false,
      todoistMode: "disconnected" as const,
      todoistNeedsReauth: false,
      weatherLocationConfigured: false,
    },
    actual: null,
    todoist: null,
    gmailPubSub: {
      tokenSource: "absent" as const,
      tokenConfigured: false,
      lastTestedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      errorCode: null,
    },
  };
}

describe("capability status service", () => {
  it("loads existing account, settings, and operational evidence without reading secret values", async () => {
    const execute = vi.fn(async (statement: { sql: string }) => {
      if (statement.sql.includes("FROM ea_accounts")) return { rows: [{ type: "icloud", needs_reauth: 0 }] };
      if (statement.sql.includes("FROM ea_settings")) return { rows: [{
        actual_budget_url: "https://actual.invalid",
        actual_budget_password_encrypted: "ciphertext",
        actual_budget_sync_id: "sync-id",
        discord_webhook_url_encrypted: "ciphertext",
        todoist_api_token_encrypted: "ciphertext",
        todoist_connection_mode: "personal_token",
        todoist_needs_reauth: 0,
        weather_lat: 34,
        weather_lng: -118,
      }] };
      if (statement.sql.includes("FROM ea_actual_metadata_mirror")) return { rows: [{ status: "current", last_success_at: "2026-07-18T00:00:00.000Z" }] };
      if (statement.sql.includes("FROM ea_gmail_pubsub_config")) return { rows: [{ push_token_hash: "hash-only", token_disabled: 0, last_tested_at: 1_000 }] };
      if (statement.sql.includes("FROM ea_todoist_sync_state")) return { rows: [{ status: "idle", last_success_at: "2026-07-18T00:00:00.000Z" }] };
      throw new Error("Unexpected query");
    });

    const result = await loadCapabilityEvidence({
      dbClient: { execute } as never,
      environment: { EA_USER_ID: "owner-1" },
    });

    expect(result).toMatchObject({
      accounts: [{ type: "icloud", needsReauth: false }],
      settings: { actualConfigured: true, discordConfigured: true, todoistConfigured: true },
      actual: { status: "current" },
      todoist: { status: "idle" },
      gmailPubSub: { tokenSource: "stored", tokenConfigured: true },
    });
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("sync-id");
  });

  it("caches metadata-only projections and supports explicit refresh", async () => {
    const getCredentialMetadata = metadataResolver();
    const loadEvidence = vi.fn(async () => evidence());
    const service = createCapabilityStatusService({
      credentialService: { getCredentialMetadata, subscribe: vi.fn(() => () => {}) },
      loadEvidence,
      now: () => 1_000,
      cacheTtlMs: 5_000,
    });

    await service.getStatus();
    await service.getStatus();
    expect(getCredentialMetadata).toHaveBeenCalledTimes(9);
    await service.getStatus({ refresh: true });
    expect(getCredentialMetadata).toHaveBeenCalledTimes(18);
  });

  it("invalidates cached status when credential metadata changes", async () => {
    let onChange: (() => void) | undefined;
    const getCredentialMetadata = metadataResolver();
    const service = createCapabilityStatusService({
      credentialService: {
        getCredentialMetadata,
        subscribe: vi.fn((listener: (event: never) => void) => { onChange = () => listener(undefined as never); return () => {}; }),
      },
      loadEvidence: vi.fn(async () => evidence()),
      now: () => 1_000,
    });

    await service.getStatus();
    onChange?.();
    await service.getStatus();
    expect(getCredentialMetadata).toHaveBeenCalledTimes(18);
  });

  it("returns no registry keys, root-key metadata, ciphertext, or raw errors", async () => {
    const response = await createCapabilityStatusService({
      credentialService: { getCredentialMetadata: metadataResolver(), subscribe: vi.fn(() => () => {}) },
      loadEvidence: vi.fn(async () => ({
        ...evidence(),
        actual: { status: "failed", lastSucceededAt: null, lastFailedAt: "2026-07-18T00:00:00.000Z", rawError: "secret-bearing provider body" },
      })),
      now: () => 1_000,
    }).getStatus();

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("ai.openai_api_key");
    expect(serialized).not.toContain("secret-bearing provider body");
  });
});
