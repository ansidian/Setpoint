import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const gmailApi = vi.hoisted(() => ({
  getAuthUrl: vi.fn((state) => `https://accounts.example.test/oauth?state=${state}`),
  handleCallback: vi.fn(async () => ({ email: "user@example.com", accountId: "gmail-user@example.com" })),
}));

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("../briefing/gmail.js", () => ({
  getAuthUrl: gmailApi.getAuthUrl,
  handleCallback: gmailApi.handleCallback,
  testConnection: vi.fn(),
}));
vi.mock("../briefing/icloud.js", () => ({ testConnection: vi.fn() }));
vi.mock("../briefing/encryption.js", () => ({
  encrypt: vi.fn((value) => value),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../briefing/weather.js", () => ({ geocodeLocation: vi.fn(async () => []) }));
vi.mock("../briefing/claude.js", () => ({ listModels: vi.fn(async () => []) }));
vi.mock("../briefing/scheduler.js", () => ({ initScheduler: vi.fn() }));
vi.mock("../embeddings/index.js", () => ({ isEmbeddingAvailable: vi.fn(() => false) }));
vi.mock("../briefing/account-canonical.js", () => ({
  canonicalizeConfiguredAccounts: vi.fn((rows) => rows),
}));
vi.mock("../briefing/bill-extractors/catalog.js", () => ({
  billExtractAvailability: vi.fn(() => []),
  isAllowedBillExtractModel: vi.fn(() => true),
  DEFAULT_BILL_EXTRACT_PROVIDER: "anthropic",
  DEFAULT_BILL_EXTRACT_MODEL: "haiku",
}));

process.env.EA_USER_ID = "user-1";

const accountsRoutes = (await import("./accounts.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/ea", accountsRoutes);
  return app;
}

const sessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

describe("accounts Gmail OAuth binding", () => {
  const stateStore = { row: null, labelUpdateArgs: null };

  beforeEach(() => {
    vi.clearAllMocks();
    stateStore.row = null;
    stateStore.labelUpdateArgs = null;
    mockDb.execute.mockImplementation(async ({ sql, args }) => {
      if (sql.includes("FROM ea_sessions")) {
        return args[0] === sessionHash || args[0] === "cookie-session"
          ? { rows: [{ expires_at: Date.now() + 60_000 }] }
          : { rows: [] };
      }
      if (sql.startsWith("INSERT INTO ea_csrf_tokens")) {
        stateStore.row = {
          token: args[0],
          account_label: args[1],
          expires_at: args[2],
          browser_bind_hash: args[3],
          oauth_user_id: args[4],
          oauth_label: args[5],
        };
        return { rowsAffected: 1 };
      }
      if (sql.startsWith("SELECT account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label FROM ea_csrf_tokens")) {
        return stateStore.row?.token === args[0] ? { rows: [stateStore.row] } : { rows: [] };
      }
      if (sql.startsWith("DELETE FROM ea_csrf_tokens")) {
        if (stateStore.row?.token === args[0]) stateStore.row = null;
        return { rowsAffected: 1 };
      }
      if (sql.startsWith("UPDATE ea_accounts SET label = ? WHERE id = ?")) {
        stateStore.labelUpdateArgs = args;
        return { rowsAffected: 1 };
      }
      return { rows: [] };
    });
  });

  it("sets a short-lived OAuth bind cookie and stores its hash", async () => {
    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/auth?label=Work")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/accounts\.example\.test\/oauth\?state=/);
    const cookieHeader = res.headers["set-cookie"][0];
    expect(cookieHeader).toContain("ea_oauth_bind=");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("HttpOnly");
    const rawBind = cookieHeader.match(/ea_oauth_bind=([^;]+)/)[1];
    expect(stateStore.row.browser_bind_hash).toBe(
      crypto.createHash("sha256").update(rawBind).digest("hex"),
    );
    expect(stateStore.row.oauth_user_id).toBe("user-1");
    expect(stateStore.row.oauth_label).toBe("Work");
  });

  it("rejects callback when browser bind cookie is missing", async () => {
    stateStore.row = {
      token: "state-1",
      account_label: "user-1:Work",
      expires_at: Date.now() + 60_000,
      browser_bind_hash: crypto.createHash("sha256").update("expected-bind").digest("hex"),
      oauth_user_id: "user-1",
      oauth_label: "Work",
    };

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1");

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/binding missing/i);
    expect(gmailApi.handleCallback).not.toHaveBeenCalled();
  });

  it("accepts callback only when browser bind cookie matches", async () => {
    stateStore.row = {
      token: "state-1",
      account_label: "user-1:Work",
      expires_at: Date.now() + 60_000,
      browser_bind_hash: crypto.createHash("sha256").update("bind-cookie").digest("hex"),
      oauth_user_id: "user-1",
      oauth_label: "Work",
    };

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/settings?account_connected=user@example.com");
    expect(gmailApi.handleCallback).toHaveBeenCalledWith("auth-code", null, "user-1");
    expect(stateStore.labelUpdateArgs).toEqual(["Work", "gmail-user@example.com"]);
    expect(res.headers["set-cookie"][0]).toContain("ea_oauth_bind=;");
  });
});
