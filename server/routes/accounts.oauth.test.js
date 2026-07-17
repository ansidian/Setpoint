import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  createAuthTestDb,
  seedGmailAccount,
  seedSession,
} from "../test-utils/auth-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));
const gmailApi = vi.hoisted(() => ({
  getAuthUrl: vi.fn((state) => `https://accounts.example.test/oauth?state=${state}`),
  handleCallback: vi.fn(async () => ({ email: "user@example.com", accountId: "gmail-user@example.com" })),
}));
const emailIndexApi = vi.hoisted(() => ({ queueEmailIndexBackfill: vi.fn(async () => ({ queued: true })) }));
const emailBackfillApi = vi.hoisted(() => ({ wakeEmailBackfillWorker: vi.fn() }));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("../email/gmail.js", () => ({
  getAuthUrl: gmailApi.getAuthUrl,
  handleCallback: gmailApi.handleCallback,
  testConnection: vi.fn(),
}));
vi.mock("../email/icloud.js", () => ({ testConnection: vi.fn() }));
vi.mock("../platform/encryption.ts", () => ({
  encrypt: vi.fn((value) => value),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../platform/weather.ts", () => ({ geocodeLocation: vi.fn(async () => []) }));
vi.mock("../scheduler.ts", () => ({ initScheduler: vi.fn() }));
vi.mock("../email/email-index.js", () => ({
  queueEmailIndexBackfill: emailIndexApi.queueEmailIndexBackfill,
}));
vi.mock("../email/email-backfill-worker.js", () => ({
  wakeEmailBackfillWorker: emailBackfillApi.wakeEmailBackfillWorker,
}));
vi.mock("../platform/account-canonical.ts", () => ({
  canonicalizeConfiguredAccounts: vi.fn((rows) => rows),
}));
vi.mock("../bills/bill-extractors/catalog.js", () => ({
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

describe("accounts Gmail OAuth binding", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testState.db.current = await createAuthTestDb();
    await seedSession(testState.db.current, "cookie-session");
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("sets a short-lived OAuth bind cookie and stores its hash", async () => {
    const before = Date.now();

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/auth?label=Work")
      .set("Cookie", ["ea_session=cookie-session"]);

    const csrfResult = await testState.db.current.execute({
      sql: "SELECT token, account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label FROM ea_csrf_tokens",
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/accounts\.example\.test\/oauth\?state=/);
    const cookieHeader = res.headers["set-cookie"][0];
    expect(cookieHeader).toContain("ea_oauth_bind=");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("HttpOnly");
    const rawBind = cookieHeader.match(/ea_oauth_bind=([^;]+)/)[1];
    expect(csrfResult.rows).toHaveLength(1);
    expect(csrfResult.rows[0]).toMatchObject({
      account_label: "user-1:Work",
      oauth_user_id: "user-1",
      oauth_label: "Work",
    });
    expect(csrfResult.rows[0].browser_bind_hash).toBe(
      crypto.createHash("sha256").update(rawBind).digest("hex"),
    );
    expect(csrfResult.rows[0].expires_at).toBeGreaterThan(before + 9 * 60 * 1000);
  });

  it("rejects callback when browser bind cookie is missing", async () => {
    await seedCsrfToken({
      token: "state-1",
      browserBind: "expected-bind",
      label: "Work",
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1");

    const csrfResult = await testState.db.current.execute({
      sql: "SELECT token FROM ea_csrf_tokens WHERE token = ?",
      args: ["state-1"],
    });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/binding missing/i);
    expect(gmailApi.handleCallback).not.toHaveBeenCalled();
    expect(csrfResult.rows).toHaveLength(0);
  });

  it("accepts callback only when browser bind cookie matches", async () => {
    await seedGmailAccount(testState.db.current, { label: "Gmail" });
    await seedCsrfToken({
      token: "state-1",
      browserBind: "bind-cookie",
      label: "Work",
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    const accountResult = await testState.db.current.execute({
      sql: "SELECT label FROM ea_accounts WHERE id = ?",
      args: ["gmail-user@example.com"],
    });
    const csrfResult = await testState.db.current.execute({
      sql: "SELECT token FROM ea_csrf_tokens WHERE token = ?",
      args: ["state-1"],
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/settings?account_connected=user@example.com");
    expect(gmailApi.handleCallback).toHaveBeenCalledWith("auth-code", null, "user-1");
    expect(accountResult.rows[0].label).toBe("Work");
    expect(csrfResult.rows).toHaveLength(0);
    expect(emailIndexApi.queueEmailIndexBackfill).toHaveBeenCalledWith("user-1");
    expect(emailBackfillApi.wakeEmailBackfillWorker).toHaveBeenCalledWith();
    expect(res.headers["set-cookie"][0]).toContain("ea_oauth_bind=;");
  });

  it("returns a generic message on callback failure without leaking the internal error", async () => {
    gmailApi.handleCallback.mockRejectedValueOnce(
      new Error("invalid_grant: token exchange failed at https://oauth.internal/secret"),
    );
    await seedCsrfToken({
      token: "state-1",
      browserBind: "bind-cookie",
      label: "Work",
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    expect(res.status).toBe(500);
    expect(res.text).toBe("OAuth failed. Please try connecting the account again.");
    expect(res.text).not.toMatch(/invalid_grant/);
    expect(res.text).not.toMatch(/oauth\.internal/);
  });
});

describe("GET /accounts needs_reauth", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testState.db.current = await createAuthTestDb();
    await seedSession(testState.db.current, "cookie-session");
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("includes needs_reauth: false for an account in good standing", async () => {
    await seedGmailAccount(testState.db.current, { id: "gmail-good", email: "good@example.com" });

    const res = await request(makeApp())
      .get("/api/ea/accounts")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    const account = res.body.find((a) => a.id === "gmail-good");
    expect(account.needs_reauth).toBe(false);
  });

  it("includes needs_reauth: true for an account flagged by a revoked grant", async () => {
    await seedGmailAccount(testState.db.current, { id: "gmail-flagged", email: "flagged@example.com" });
    await testState.db.current.execute({
      sql: "UPDATE ea_accounts SET needs_reauth = 1 WHERE id = ?",
      args: ["gmail-flagged"],
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    const account = res.body.find((a) => a.id === "gmail-flagged");
    expect(account.needs_reauth).toBe(true);
  });
});

async function seedCsrfToken({ token, browserBind, label }) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_csrf_tokens
            (token, account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      token,
      `user-1:${label}`,
      Date.now() + 60_000,
      crypto.createHash("sha256").update(browserBind).digest("hex"),
      "user-1",
      label,
    ],
  });
}
