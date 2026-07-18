import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoistOAuthService } from "../tasks/todoist-oauth.ts";

vi.mock("../middleware/auth.ts", () => ({
  hashToken: (value: string) => `hash:${value}`,
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" ? next() : res.status(401).json({ message: "Not authenticated" }),
}));

const { createTodoistOAuthRouter } = await import("./todoist-oauth.ts");

function makeApp(serviceOverrides: Partial<TodoistOAuthService> = {}) {
  const service = {
    beginAuthorization: vi.fn(async () => ({ url: "https://app.todoist.com/oauth/authorize?state=opaque" })),
    completeAuthorization: vi.fn(async () => ({ connected: true as const })),
    getStatus: vi.fn(async () => ({ mode: "personal_token", configured: true })),
    ...serviceOverrides,
  } as unknown as TodoistOAuthService;
  const app = express();
  app.use(cookieParser());
  app.use("/api/ea", createTodoistOAuthRouter(service, () => "browser-bind"));
  return { app, service };
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
});
