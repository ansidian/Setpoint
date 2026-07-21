import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import type { AiCredentialManager } from "../ai-credentials.ts";
import type { LocationCredentialManager } from "../location-credentials.ts";
import type { GoogleOAuthCredentialManager } from "../google-oauth-credentials.ts";
import type { GmailPubSubService } from "../email/gmail-pubsub.ts";
import type { TodoistOAuthCredentialManager } from "../tasks/todoist-oauth-credentials.ts";

vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" || req.cookies?.ea_session === "stale"
      ? next()
      : res.status(401).json({ message: "Not authenticated" }),
  requireRecentPasswordAuth: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid"
      ? next()
      : res.status(403).json({
          code: "PASSWORD_STEP_UP_REQUIRED",
          message: "Confirm your password to continue",
        }),
}));

const { errorHandler } = await import("../middleware/async-handler.ts");
const { createInstanceCredentialsRouter } = await import("./instance-credentials.ts");

function createApp(
  serviceOverrides: Partial<InstanceCredentialService> = {},
  aiManagerOverrides: Partial<AiCredentialManager> = {},
  locationManagerOverrides: Partial<LocationCredentialManager> = {},
  googleOAuthManagerOverrides: Partial<GoogleOAuthCredentialManager> = {},
  gmailPubSubManagerOverrides: Partial<GmailPubSubService> = {},
  todoistOAuthManagerOverrides: Partial<TodoistOAuthCredentialManager> = {},
) {
  const metadata = {
    key: "ai.openai_api_key",
    handling: "secret" as const,
    capabilities: ["email_triage", "bill_extraction", "semantic_email_search"],
    source: "stored" as const,
    activeConfigured: true,
    pendingConfigured: true,
    pendingStagedAt: 100,
    pendingExpiresAt: 86_400_100,
    validationState: "pending" as const,
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: 2,
  };
  const service = {
    getMetadata: vi.fn(async () => ({
      credentials: [metadata],
      rootKey: { configured: true, valid: true, fingerprint: "sha256:abc", decryptability: "ok" as const },
    })),
    stagePending: vi.fn(async () => metadata),
    discardPending: vi.fn(async () => ({ ...metadata, pendingConfigured: false, pendingStagedAt: null, pendingExpiresAt: null })),
    importEnvironment: vi.fn(async () => metadata),
    disable: vi.fn(async () => ({ ...metadata, source: "disabled" as const })),
    useHostValue: vi.fn(async () => ({ ...metadata, source: "environment" as const })),
    ...serviceOverrides,
  } as unknown as InstanceCredentialService;
  const app = express();
  const aiManager = {
    testPending: vi.fn(async () => ({ ok: true, code: "VALID", metadata })),
    ...aiManagerOverrides,
  } as unknown as AiCredentialManager;
  const locationManager = {
    testPending: vi.fn(async () => ({ ok: true, code: "VALID", metadata })),
    ...locationManagerOverrides,
  } as unknown as LocationCredentialManager;
  const googleOAuthManager = {
    stageCandidate: vi.fn(async () => ({
      credentials: [metadata, { ...metadata, key: "google.oauth_client_secret" }],
      candidateVersions: { clientId: 3, clientSecret: 4 },
    })),
    importEnvironment: vi.fn(async () => [
      { ...metadata, key: "google.oauth_client_id" },
      { ...metadata, key: "google.oauth_client_secret" },
    ]),
    disable: vi.fn(async () => [
      { ...metadata, key: "google.oauth_client_id", source: "disabled" as const },
      { ...metadata, key: "google.oauth_client_secret", source: "disabled" as const },
    ]),
    useHostValues: vi.fn(async () => [
      { ...metadata, key: "google.oauth_client_id", source: "environment" as const },
      { ...metadata, key: "google.oauth_client_secret", source: "environment" as const },
    ]),
    discardCandidate: vi.fn(async () => [
      { ...metadata, key: "google.oauth_client_id", pendingConfigured: false },
      { ...metadata, key: "google.oauth_client_secret", pendingConfigured: false },
    ]),
    ...googleOAuthManagerOverrides,
  } as unknown as GoogleOAuthCredentialManager;
  const gmailPubSubManager = {
    getStatus: vi.fn(async () => ({ configured: false, healthy: true, deliveryMode: "periodic", delayedUpdates: true })),
    setTopic: vi.fn(async () => metadata),
    generateCallback: vi.fn(async () => ({
      callbackUrl: "https://setpoint.example.com/api/gmail/push?token=one-time-value",
      status: { configured: true },
    })),
    importEnvironmentToken: vi.fn(async () => ({ configured: true })),
    useHostToken: vi.fn(async () => ({ configured: true })),
    revokeToken: vi.fn(async () => ({ configured: false })),
    testWatches: vi.fn(async () => ({ ok: true, errorCode: null, checked: 1, registered: 1 })),
    ...gmailPubSubManagerOverrides,
  } as unknown as GmailPubSubService;
  const todoistOAuthManager = {
    stageCandidate: vi.fn(async () => ({
      credentials: [metadata, { ...metadata, key: "tasks.todoist_client_secret" }],
      candidateVersions: { clientId: 5, clientSecret: 6 },
    })),
    importEnvironment: vi.fn(async () => [
      { ...metadata, key: "tasks.todoist_client_id" },
      { ...metadata, key: "tasks.todoist_client_secret" },
    ]),
    discardCandidate: vi.fn(async () => [
      { ...metadata, key: "tasks.todoist_client_id", pendingConfigured: false },
      { ...metadata, key: "tasks.todoist_client_secret", pendingConfigured: false },
    ]),
    ...todoistOAuthManagerOverrides,
  } as unknown as TodoistOAuthCredentialManager;
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    "/api/instance-credentials",
    createInstanceCredentialsRouter(
      service,
      aiManager,
      locationManager,
      googleOAuthManager,
      gmailPubSubManager,
      todoistOAuthManager,
    ),
  );
  app.use(errorHandler);
  return {
    app,
    service,
    aiManager,
    locationManager,
    googleOAuthManager,
    gmailPubSubManager,
    todoistOAuthManager,
  };
}

describe("instance credential routes", () => {
  it("requires cookie authentication for metadata", async () => {
    const { app } = createApp();
    expect((await request(app).get("/api/instance-credentials")).status).toBe(401);
  });

  it("allows redacted metadata but rejects mutations without recent password auth", async () => {
    const { app, service } = createApp();
    const metadata = await request(app)
      .get("/api/instance-credentials")
      .set("Cookie", "ea_session=stale");
    const mutation = await request(app)
      .put("/api/instance-credentials/ai.openai_api_key/pending")
      .set("Cookie", "ea_session=stale")
      .send({ value: "browser-secret" });

    expect(metadata.status).toBe(200);
    expect(mutation.status).toBe(403);
    expect(mutation.body).toEqual({
      code: "PASSWORD_STEP_UP_REQUIRED",
      message: "Confirm your password to continue",
    });
    expect(service.stagePending).not.toHaveBeenCalled();
  });

  it("accepts write-only candidates without returning plaintext", async () => {
    const { app, service } = createApp();
    const response = await request(app)
      .put("/api/instance-credentials/ai.openai_api_key/pending")
      .set("Cookie", "ea_session=valid")
      .send({ value: "browser-secret" });

    expect(response.status).toBe(200);
    expect(service.stagePending).toHaveBeenCalledWith("ai.openai_api_key", "browser-secret");
    expect(JSON.stringify(response.body)).not.toContain("browser-secret");
  });

  it("discards a generic candidate by expected version with recent password auth", async () => {
    const { app, service } = createApp();
    const blocked = await request(app)
      .delete("/api/instance-credentials/ai.openai_api_key/pending")
      .set("Cookie", "ea_session=stale")
      .send({ expectedVersion: 2 });
    const response = await request(app)
      .delete("/api/instance-credentials/ai.openai_api_key/pending")
      .set("Cookie", "ea_session=valid")
      .send({ expectedVersion: 2 });

    expect(blocked.status).toBe(403);
    expect(response.status).toBe(200);
    expect(service.discardPending).toHaveBeenCalledWith("ai.openai_api_key", 2);
    expect(response.body).toMatchObject({ pendingConfigured: false });
  });

  it("stages the Google application pair through one write-only provider action", async () => {
    const { app, googleOAuthManager } = createApp();
    const response = await request(app)
      .put("/api/instance-credentials/google-oauth/pending")
      .set("Cookie", "ea_session=valid")
      .send({ clientId: "browser-client-id", clientSecret: "browser-client-secret" });

    expect(response.status).toBe(200);
    expect(googleOAuthManager.stageCandidate).toHaveBeenCalledWith({
      clientId: "browser-client-id",
      clientSecret: "browser-client-secret",
    });
    expect(JSON.stringify(response.body)).not.toContain("browser-client-id");
    expect(JSON.stringify(response.body)).not.toContain("browser-client-secret");
  });

  it.each([
    ["import-environment", "importEnvironment"],
    ["disable", "disable"],
    ["use-host", "useHostValues"],
  ] as const)("changes the Google pair through the atomic %s action", async (path, method) => {
    const { app, googleOAuthManager } = createApp();
    const response = await request(app)
      .post(`/api/instance-credentials/google-oauth/${path}`)
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(googleOAuthManager[method]).toHaveBeenCalledTimes(1);
    expect(response.body.credentials).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain("environment-secret-value");
  });

  it("discards the Google pair through one version-bound action", async () => {
    const { app, googleOAuthManager } = createApp();
    const response = await request(app)
      .delete("/api/instance-credentials/google-oauth/pending")
      .set("Cookie", "ea_session=valid")
      .send({ candidateVersions: { clientId: 3, clientSecret: 4 } });

    expect(response.status).toBe(200);
    expect(googleOAuthManager.discardCandidate).toHaveBeenCalledWith({ clientId: 3, clientSecret: 4 });
    expect(response.body.credentials).toHaveLength(2);
  });

  it("rejects generic single-key mutations for provider-owned credential pairs", async () => {
    const { app, service } = createApp();
    const response = await request(app)
      .post("/api/instance-credentials/google.oauth_client_id/disable")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: "CREDENTIAL_GROUP_ACTION_REQUIRED",
      message: "Use the provider-owned credential-pair action",
    });
    expect(service.disable).not.toHaveBeenCalled();
  });

  it("stages the Todoist application pair without returning plaintext", async () => {
    const { app, todoistOAuthManager } = createApp();
    const response = await request(app)
      .put("/api/instance-credentials/todoist-oauth/pending")
      .set("Cookie", "ea_session=valid")
      .send({ clientId: "browser-client-id", clientSecret: "browser-client-secret" });

    expect(response.status).toBe(200);
    expect(todoistOAuthManager.stageCandidate).toHaveBeenCalledWith({
      clientId: "browser-client-id",
      clientSecret: "browser-client-secret",
    });
    expect(JSON.stringify(response.body)).not.toContain("browser-client-id");
    expect(JSON.stringify(response.body)).not.toContain("browser-client-secret");
  });

  it("discards the Todoist pair through one version-bound action", async () => {
    const { app, todoistOAuthManager } = createApp();
    const response = await request(app)
      .delete("/api/instance-credentials/todoist-oauth/pending")
      .set("Cookie", "ea_session=valid")
      .send({ candidateVersions: { clientId: 5, clientSecret: 6 } });

    expect(response.status).toBe(200);
    expect(todoistOAuthManager.discardCandidate).toHaveBeenCalledWith({ clientId: 5, clientSecret: 6 });
  });

  it("rejects generic pair-member discard and malformed expected versions", async () => {
    const { app, service } = createApp();
    const pair = await request(app)
      .delete("/api/instance-credentials/google.oauth_client_id/pending")
      .set("Cookie", "ea_session=valid")
      .send({ expectedVersion: 3 });
    const malformed = await request(app)
      .delete("/api/instance-credentials/ai.openai_api_key/pending")
      .set("Cookie", "ea_session=valid")
      .send({ expectedVersion: "3" });

    expect(pair.status).toBe(409);
    expect(malformed.status).toBe(400);
    expect(service.discardPending).not.toHaveBeenCalled();
  });

  it("migrates Todoist host credentials through an explicit redacted action", async () => {
    const { app, todoistOAuthManager } = createApp();
    const response = await request(app)
      .post("/api/instance-credentials/todoist-oauth/import-environment")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(todoistOAuthManager.importEnvironment).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain("environment-secret-value");
  });

  it("returns a fixed allowlist error without reflecting unknown keys or submitted values", async () => {
    const error = Object.assign(new Error("Credential key is not supported"), { status: 404 });
    const { app } = createApp({ stagePending: vi.fn(async () => { throw error; }) });
    const response = await request(app)
      .put("/api/instance-credentials/unknown.secret/pending")
      .set("Cookie", "ea_session=valid")
      .send({ value: "do-not-reflect" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Credential key is not supported" });
    expect(JSON.stringify(response.body)).not.toContain("unknown.secret");
    expect(JSON.stringify(response.body)).not.toContain("do-not-reflect");
  });

  it("does not expose a generic promotion or secret-read endpoint", async () => {
    const { app } = createApp();
    const promotion = await request(app)
      .post("/api/instance-credentials/ai.openai_api_key/promote")
      .set("Cookie", "ea_session=valid");
    const read = await request(app)
      .get("/api/instance-credentials/ai.openai_api_key/value")
      .set("Cookie", "ea_session=valid");
    expect(promotion.status).toBe(404);
    expect(read.status).toBe(404);
  });

  it("tests and promotes only through the provider-owned redacted workflow", async () => {
    const { app, aiManager } = createApp();
    const response = await request(app)
      .post("/api/instance-credentials/ai.openai_api_key/test")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, code: "VALID" });
    expect(aiManager.testPending).toHaveBeenCalledWith("ai.openai_api_key");
  });

  it("returns a stable failed-test result without provider detail", async () => {
    const { app } = createApp({}, {
      testPending: vi.fn(async (_key: string) => ({
        ok: false,
        code: "INVALID_CREDENTIAL" as const,
        metadata: {
          key: "ai.openai_api_key",
          handling: "secret" as const,
          capabilities: ["email_triage", "bill_extraction", "semantic_email_search"],
          source: "stored" as const,
          activeConfigured: true,
          pendingConfigured: true,
          pendingStagedAt: 1,
          pendingExpiresAt: 86_400_001,
          validationState: "invalid" as const,
          lastTestedAt: 1,
          lastSucceededAt: null,
          lastFailedAt: 1,
          errorCode: "INVALID_CREDENTIAL",
          version: 4,
        },
      })),
    });
    const response = await request(app)
      .post("/api/instance-credentials/ai.openai_api_key/test")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ ok: false, code: "INVALID_CREDENTIAL" });
    expect(JSON.stringify(response.body)).not.toContain("provider body");
  });

  it("routes weather and Places tests through their provider-owned workflow", async () => {
    const { app, aiManager, locationManager } = createApp();

    const response = await request(app)
      .post("/api/instance-credentials/weather.pirate_weather_api_key/test")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(locationManager.testPending).toHaveBeenCalledWith("weather.pirate_weather_api_key");
    expect(aiManager.testPending).not.toHaveBeenCalled();
  });

  it("reveals a generated Gmail callback only from the generation action", async () => {
    const { app, gmailPubSubManager } = createApp();
    const generated = await request(app)
      .post("/api/instance-credentials/gmail-pubsub/generate-callback")
      .set("Cookie", "ea_session=valid");
    const status = await request(app)
      .get("/api/instance-credentials/gmail-pubsub")
      .set("Cookie", "ea_session=valid");

    expect(generated.status).toBe(200);
    expect(generated.body.callbackUrl).toContain("one-time-value");
    expect(JSON.stringify(status.body)).not.toContain("one-time-value");
    expect(gmailPubSubManager.generateCallback).toHaveBeenCalledTimes(1);
  });

  it("exposes an explicit redacted Gmail watch-registration test action", async () => {
    const { app, gmailPubSubManager } = createApp();
    const response = await request(app)
      .post("/api/instance-credentials/gmail-pubsub/test-watches")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, errorCode: null, checked: 1, registered: 1 });
    expect(gmailPubSubManager.testWatches).toHaveBeenCalledTimes(1);
  });
});
