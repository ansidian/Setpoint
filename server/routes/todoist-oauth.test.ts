import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoistOAuthService } from "../tasks/todoist-oauth.ts";

vi.mock("../middleware/auth.ts", () => ({
  hashToken: (value: string) => `hash:${value}`,
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" || req.cookies?.ea_session === "stale"
      ? next()
      : res.status(401).json({ message: "Not authenticated" }),
  requireRecentPasswordAuth: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid"
      ? next()
      : req.cookies?.ea_session === "stale"
        ? res.status(403).json({ code: "PASSWORD_STEP_UP_REQUIRED", message: "Confirm your password" })
        : res.status(401).json({ message: "Not authenticated" }),
}));

const { createTodoistOAuthRouter } = await import("./todoist-oauth.ts");

function makeApp(serviceOverrides: Partial<TodoistOAuthService> = {}, personalTokenOverrides = {}) {
  const service = {
    beginAuthorization: vi.fn(async () => ({ url: "https://app.todoist.com/oauth/authorize?state=opaque" })),
    completeAuthorization: vi.fn(async () => ({ connected: true as const })),
    getStatus: vi.fn(async () => ({ mode: "personal_token", configured: true })),
    ...serviceOverrides,
  } as unknown as TodoistOAuthService;
  const personalTokenService = {
    saveCandidate: vi.fn(async () => ({ success: true as const, verifiedAt: "2026-07-19T18:00:00.000Z" })),
    disconnect: vi.fn(async () => ({ success: true as const })),
    ...personalTokenOverrides,
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/ea", createTodoistOAuthRouter(service, () => "browser-bind", personalTokenService));
  return { app, service, personalTokenService };
}

describe("Todoist OAuth routes", () => {
  beforeEach(() => {
    process.env.EA_USER_ID = "owner-1";
  });

  it("requires authentication to begin and sets a callback-scoped HttpOnly binding", async () => {
    const { app, service } = makeApp();
    expect((await request(app).get("/api/ea/accounts/todoist/auth")).status).toBe(401);

    const response = await request(app)
      .get("/api/ea/accounts/todoist/auth")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://app.todoist.com/oauth/authorize?state=opaque" });
    expect(response.headers["set-cookie"]?.[0]).toContain("ea_todoist_oauth_bind=browser-bind");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("Path=/api/ea/accounts/todoist/callback");
    expect(service.beginAuthorization).toHaveBeenCalledWith("owner-1", "hash:browser-bind");
  });

  it("completes only with the callback browser binding and redirects without token data", async () => {
    const { app, service } = makeApp();
    const response = await request(app)
      .get("/api/ea/accounts/todoist/callback?code=provider-code&state=opaque")
      .set("Cookie", "ea_todoist_oauth_bind=browser-bind");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173/settings?todoist_connected=1");
    expect(service.completeAuthorization).toHaveBeenCalledWith({
      code: "provider-code",
      state: "opaque",
      browserBindHash: "hash:browser-bind",
    });
    expect(response.text).not.toContain("provider-code");
  });

  it("returns a fixed callback failure without reflecting provider or secret detail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app } = makeApp({
      completeAuthorization: vi.fn(async () => {
        throw new Error("provider body contained secret-value");
      }),
    });
    const response = await request(app)
      .get("/api/ea/accounts/todoist/callback?code=secret-code&state=opaque")
      .set("Cookie", "ea_todoist_oauth_bind=browser-bind");

    expect(response.status).toBe(400);
    expect(response.text).toBe("Todoist OAuth failed. Please try connecting again.");
    expect(response.text).not.toContain("secret-value");
    expect(response.text).not.toContain("secret-code");
  });

  it("returns redacted Todoist mode metadata only to an authenticated owner", async () => {
    const { app, service } = makeApp();
    expect((await request(app).get("/api/ea/accounts/todoist/status")).status).toBe(401);

    const response = await request(app)
      .get("/api/ea/accounts/todoist/status")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mode: "personal_token", configured: true });
    expect(service.getStatus).toHaveBeenCalledWith("owner-1");
  });

  it("allows stale sessions to read status but rejects every credential-changing action", async () => {
    const { app, service, personalTokenService } = makeApp();

    expect((await request(app)
      .get("/api/ea/accounts/todoist/status")
      .set("Cookie", "ea_session=stale")).status).toBe(200);
    expect((await request(app)
      .get("/api/ea/accounts/todoist/auth")
      .set("Cookie", "ea_session=stale")).status).toBe(403);
    expect((await request(app)
      .post("/api/ea/accounts/todoist/personal-token")
      .set("Cookie", "ea_session=stale")
      .send({ token: "candidate-token" })).status).toBe(403);
    expect((await request(app)
      .delete("/api/ea/accounts/todoist/connection")
      .set("Cookie", "ea_session=stale")).status).toBe(403);
    expect(service.beginAuthorization).not.toHaveBeenCalled();
    expect(personalTokenService.saveCandidate).not.toHaveBeenCalled();
    expect(personalTokenService.disconnect).not.toHaveBeenCalled();
  });

  it("validates and saves a personal-token candidate without returning the token", async () => {
    const { app, personalTokenService } = makeApp();
    const response = await request(app)
      .post("/api/ea/accounts/todoist/personal-token")
      .set("Cookie", "ea_session=valid")
      .send({ token: "candidate-token" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, verifiedAt: "2026-07-19T18:00:00.000Z" });
    expect(response.text).not.toContain("candidate-token");
    expect(personalTokenService.saveCandidate).toHaveBeenCalledWith("owner-1", "candidate-token");
  });

  it("disconnects the active Todoist mode through an effect-specific endpoint", async () => {
    const { app, personalTokenService } = makeApp();
    const response = await request(app)
      .delete("/api/ea/accounts/todoist/connection")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(personalTokenService.disconnect).toHaveBeenCalledWith("owner-1");
  });
});
