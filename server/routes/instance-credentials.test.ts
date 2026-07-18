import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import type { AiCredentialManager } from "../ai-credentials.ts";

vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" ? next() : res.status(401).json({ message: "Not authenticated" }),
}));

const { errorHandler } = await import("../middleware/async-handler.ts");
const { createInstanceCredentialsRouter } = await import("./instance-credentials.ts");

function createApp(
  serviceOverrides: Partial<InstanceCredentialService> = {},
  aiManagerOverrides: Partial<AiCredentialManager> = {},
) {
  const metadata = {
    key: "ai.openai_api_key",
    handling: "secret" as const,
    capabilities: ["email_triage", "bill_extraction", "semantic_email_search"],
    source: "stored" as const,
    activeConfigured: true,
    pendingConfigured: true,
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
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/instance-credentials", createInstanceCredentialsRouter(service, aiManager));
  app.use(errorHandler);
  return { app, service, aiManager };
}

describe("instance credential routes", () => {
  it("requires cookie authentication for metadata", async () => {
    const { app } = createApp();
    expect((await request(app).get("/api/instance-credentials")).status).toBe(401);
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
});
