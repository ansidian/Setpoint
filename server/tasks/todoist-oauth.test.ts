import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTodoistOAuthService } from "./todoist-oauth.ts";

describe("Todoist OAuth service", () => {
  let db: Client;
  const credentials = {
    clientId: "candidate-client-id",
    clientSecret: "candidate-client-secret",
  };
  const candidateVersions = { clientId: 4, clientSecret: 7 };

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_todoist_oauth_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        browser_bind_hash TEXT NOT NULL,
        client_id_version INTEGER,
        client_secret_version INTEGER,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        todoist_api_token_encrypted TEXT,
        todoist_oauth_refresh_token_encrypted TEXT,
        todoist_connection_mode TEXT,
        todoist_needs_reauth INTEGER NOT NULL DEFAULT 0
      );
    `);
  });

  afterEach(() => db.close());

  function setup(fetchFn = vi.fn()) {
    const credentialManager = {
      selectForAuthorization: vi.fn(async () => ({ credentials, candidateVersions })),
      resolveCandidate: vi.fn(async () => credentials),
      resolveActive: vi.fn(async () => credentials),
      promoteCandidate: vi.fn(async () => []),
    };
    const storeTokenResponse = vi.fn(async () => ({ accessToken: "access-token", expiresAt: null }));
    const service = createTodoistOAuthService({
      dbClient: db,
      credentialManager: credentialManager as never,
      canonicalUrlResolver: vi.fn(async () => "https://setpoint.example.com/api/ea/accounts/todoist/callback"),
      fetchFn: fetchFn as never,
      storeTokenResponse,
      randomState: () => "state-1",
      now: () => 1_000,
      credentialMetadataResolver: vi.fn(async (key: string) => ({
        key,
        source: "environment",
        activeConfigured: true,
        pendingConfigured: false,
      })) as never,
      webhookUrlResolver: vi.fn(async () => "https://setpoint.example.com/api/todoist/webhook"),
    });
    return { service, credentialManager, storeTokenResponse };
  }

  it("binds authorization to the browser, owner, callback, and pending credential versions", async () => {
    const { service } = setup();
    const result = await service.beginAuthorization("owner-1", "browser-hash");
    const url = new URL(result.url);

    expect(url.origin + url.pathname).toBe("https://app.todoist.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("candidate-client-id");
    expect(url.searchParams.get("scope")).toBe("data:read_write,data:delete");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("response_type")).toBe("code");

    const row = (await db.execute("SELECT * FROM ea_todoist_oauth_states")).rows[0]!;
    expect(row.user_id).toBe("owner-1");
    expect(row.browser_bind_hash).toBe("browser-hash");
    expect(row.client_id_version).toBe(4);
    expect(row.client_secret_version).toBe(7);
  });

  it("rejects a callback from another browser before exchanging or promoting", async () => {
    const fetchFn = vi.fn();
    const { service, credentialManager, storeTokenResponse } = setup(fetchFn);
    await service.beginAuthorization("owner-1", "browser-hash");

    await expect(service.completeAuthorization({
      code: "authorization-code",
      state: "state-1",
      browserBindHash: "other-browser-hash",
    })).rejects.toMatchObject({ code: "TODOIST_OAUTH_BROWSER_MISMATCH", status: 400 });
    // test-architecture: allow-boundary-interaction -- Browser binding must fail before the outbound Todoist token exchange request.
    expect(fetchFn).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- A browser-binding failure must not persist any OAuth token secrets.
    expect(storeTokenResponse).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- A browser-binding failure must not promote staged write-only application credentials.
    expect(credentialManager.promoteCandidate).not.toHaveBeenCalled();
  });

  it("promotes the matching app pair only after a successful token exchange", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "oauth-access-token",
        refresh_token: "oauth-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "data:read_write,data:delete",
      }),
    }));
    const { service, credentialManager, storeTokenResponse } = setup(fetchFn);
    await service.beginAuthorization("owner-1", "browser-hash");

    await service.completeAuthorization({
      code: "authorization-code",
      state: "state-1",
      browserBindHash: "browser-hash",
    });

    // test-architecture: allow-boundary-interaction -- Todoist OAuth and credential promotion are outbound credential/process boundaries; request data and promotion ordering are the security protocol contract.
    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get("client_secret")).toBe("candidate-client-secret");
    expect(body.get("redirect_uri")).toBe("https://setpoint.example.com/api/ea/accounts/todoist/callback");
    // test-architecture: allow-boundary-interaction -- Credential promotion is a write-only secret-store boundary and must bind the exact candidate versions consumed by the callback.
    expect(credentialManager.promoteCandidate).toHaveBeenCalledWith(candidateVersions);
    // test-architecture: allow-boundary-interaction -- OAuth token persistence is a secret database boundary; the successful provider response must be stored for the exact owner.
    expect(storeTokenResponse).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ access_token: "oauth-access-token", refresh_token: "oauth-refresh-token" }),
    );
    // test-architecture: allow-boundary-interaction -- Todoist OAuth and credential promotion are outbound credential/process boundaries; request data and promotion ordering are the security protocol contract.
    expect(fetchFn.mock.invocationCallOrder[0]).toBeLessThan(
      // test-architecture: allow-boundary-interaction -- Todoist OAuth and credential promotion are outbound credential/process boundaries; request data and promotion ordering are the security protocol contract.
      credentialManager.promoteCandidate.mock.invocationCallOrder[0]!,
    );
  });

  it("leaves working credentials untouched when Todoist rejects the exchange", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"bad_authorization_code"}',
    }));
    const { service, credentialManager, storeTokenResponse } = setup(fetchFn);
    await service.beginAuthorization("owner-1", "browser-hash");

    await expect(service.completeAuthorization({
      code: "bad-code",
      state: "state-1",
      browserBindHash: "browser-hash",
    })).rejects.toMatchObject({ code: "TODOIST_OAUTH_EXCHANGE_FAILED", status: 422 });
    // test-architecture: allow-boundary-interaction -- A rejected provider exchange must leave the active write-only credential pair untouched.
    expect(credentialManager.promoteCandidate).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- A rejected provider exchange must not corrupt durable OAuth token storage.
    expect(storeTokenResponse).not.toHaveBeenCalled();
  });

  it("reports explicit mode, redacted app source, and canonical callback URLs", async () => {
    const { service } = setup();
    await db.execute({
      sql: `INSERT INTO ea_settings
              (user_id, todoist_api_token_encrypted, todoist_oauth_refresh_token_encrypted,
               todoist_connection_mode, todoist_needs_reauth)
            VALUES (?, ?, ?, 'oauth', 1)`,
      args: ["owner-1", "encrypted-access", "encrypted-refresh"],
    });

    await expect(service.getStatus("owner-1")).resolves.toEqual({
      mode: "oauth",
      configured: true,
      oauthRefreshable: true,
      needsReauth: true,
      application: {
        configured: true,
        source: "environment",
        pendingConfigured: false,
        pendingStagedAt: null,
        pendingExpiresAt: null,
        candidateVersions: null,
      },
      callbackUrl: "https://setpoint.example.com/api/ea/accounts/todoist/callback",
      webhookUrl: "https://setpoint.example.com/api/todoist/webhook",
      deliveryMode: "webhook_ready",
    });
    expect(JSON.stringify(await service.getStatus("owner-1"))).not.toContain("encrypted-access");
  });
});
