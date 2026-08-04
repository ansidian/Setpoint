import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoistOAuthService } from "../tasks/todoist-oauth.ts";
import type { Client } from "@libsql/client";
import { createAuthTestDb, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import {
  createRequireCookieSession,
  createRequireRecentPasswordAuth,
  hashToken,
} from "../middleware/auth.ts";
import { createTodoistOAuthRouter } from "./todoist-oauth.ts";

let authDb: Client;

function makeApp(serviceOverrides: Partial<TodoistOAuthService> = {}, personalTokenOverrides = {}) {
  const service = {
    beginAuthorization: async (userId: string, browserBindHash: string) => ({
      url: `https://app.todoist.com/oauth/authorize?state=${userId}:${browserBindHash}`,
    }),
    completeAuthorization: async (input: { code: string; state: string; browserBindHash: string }) => {
      if (JSON.stringify(input) !== JSON.stringify({
        code: "provider-code",
        state: "opaque",
        browserBindHash: hashToken("browser-bind"),
      })) throw new Error("Callback inputs changed");
      return { connected: true as const };
    },
    getStatus: async (userId: string) => ({ mode: "personal_token", configured: userId === "owner-1" }),
    ...serviceOverrides,
  } as unknown as TodoistOAuthService;
  const personalTokenService = {
    saveCandidate: async (userId: string, token: string) => ({
      success: true as const,
      verifiedAt: `${userId}:${token.length}`,
    }),
    disconnect: async () => ({ success: true as const }),
    ...personalTokenOverrides,
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/ea", createTodoistOAuthRouter(
    service,
    () => "browser-bind",
    personalTokenService,
    {
      cookie: createRequireCookieSession(authDb),
      recent: createRequireRecentPasswordAuth(authDb),
    },
  ));
  return { app, service, personalTokenService };
}

describe("Todoist OAuth routes", () => {
  beforeEach(async () => {
    process.env.EA_USER_ID = "owner-1";
    authDb = await createAuthTestDb();
    await seedOwner(authDb, { userId: "owner-1", passwordHash: "hash" });
    await seedSession(authDb, "valid", Date.now() + 60_000, Date.now(), {
      authMethod: "password",
      passwordAuthenticatedAt: Date.now(),
    });
    await seedSession(authDb, "stale", Date.now() + 60_000, 0, {
      authMethod: "legacy",
      passwordAuthenticatedAt: 0,
    });
  });

  afterEach(() => authDb.close());

  it("requires authentication to begin and sets a callback-scoped HttpOnly binding", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/ea/accounts/todoist/auth")).status).toBe(401);

    const response = await request(app)
      .get("/api/ea/accounts/todoist/auth")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: `https://app.todoist.com/oauth/authorize?state=owner-1:${hashToken("browser-bind")}`,
    });
    expect(response.headers["set-cookie"]?.[0]).toContain("ea_todoist_oauth_bind=browser-bind");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("Path=/api/ea/accounts/todoist/callback");
  });

  it("completes only with the callback browser binding and redirects without token data", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .get("/api/ea/accounts/todoist/callback?code=provider-code&state=opaque")
      .set("Cookie", "ea_todoist_oauth_bind=browser-bind");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173/settings?todoist_connected=1");
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
    const { app } = makeApp();
    expect((await request(app).get("/api/ea/accounts/todoist/status")).status).toBe(401);

    const response = await request(app)
      .get("/api/ea/accounts/todoist/status")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mode: "personal_token", configured: true });
  });

  it("allows stale sessions to read status but rejects every credential-changing action", async () => {
    const { app } = makeApp();

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
  });

  it("validates and saves a personal-token candidate without returning the token", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .post("/api/ea/accounts/todoist/personal-token")
      .set("Cookie", "ea_session=valid")
      .send({ token: "candidate-token" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, verifiedAt: "owner-1:15" });
    expect(response.text).not.toContain("candidate-token");
  });

  it("disconnects the active Todoist mode through an effect-specific endpoint", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .delete("/api/ea/accounts/todoist/connection")
      .set("Cookie", "ea_session=valid");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});
