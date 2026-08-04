import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "../test-utils/supertest.ts";
import type { Response as SuperTestResponse } from "../test-utils/supertest.ts";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import {
  createAuthTestDb,
  seedGmailAccount,
  seedOwner,
  seedSession,
} from "../test-utils/auth-db.ts";
import type { AccountSummary } from "../../shared/types/accounts.ts";

const testState = vi.hoisted<{
  db: Client | null;
  candidateVersions: { clientId: number; clientSecret: number } | null;
}>(() => ({ db: null, candidateVersions: null }));

const gmailProvider = vi.hoisted(() => ({
  getAuthUrl: vi.fn(),
  handleCallback: vi.fn(),
  testConnection: vi.fn(),
}));

const emailBackfillProcess = vi.hoisted(() => ({
  wakeEmailBackfillWorker: vi.fn(),
}));

function currentDb(): Client {
  if (!testState.db) throw new Error("Test database is not initialized");
  return testState.db;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real OAuth binding, credential persistence, account, and email-index modules execute together.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
    transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
  },
}));

// test-architecture: allow-boundary-mock -- Gmail is the outbound provider boundary; the route and durable OAuth state remain real.
vi.mock("../email/gmail.ts", () => gmailProvider);

// test-architecture: allow-boundary-mock -- waking the long-lived email backfill worker is a process lifecycle boundary; queue persistence uses the real email-index module.
vi.mock("../email/email-backfill-worker.ts", () => emailBackfillProcess);

process.env.EA_USER_ID = "user-1";
process.env.EA_ENCRYPTION_KEY = "11".repeat(32);
process.env.NODE_ENV = "test";

const { googleOAuthCredentialManager } = await import("../google-oauth-credentials.ts");
const accountsRoutes = (await import("./accounts.ts")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/ea", accountsRoutes);
  return app;
}

function setCookieHeader(response: SuperTestResponse): string {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value.join(";") : String(value || "");
}

async function seedCsrfToken({
  token,
  browserBind,
  label,
  expiresAt = Date.now() + 60_000,
}: {
  token: string;
  browserBind: string;
  label: string;
  expiresAt?: number;
}) {
  const candidate = testState.candidateVersions;
  await currentDb().execute({
    sql: `INSERT INTO ea_csrf_tokens
            (token, account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label,
             google_client_id_version, google_client_secret_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      token,
      `user-1:${label}`,
      expiresAt,
      crypto.createHash("sha256").update(browserBind).digest("hex"),
      "user-1",
      label,
      candidate?.clientId ?? null,
      candidate?.clientSecret ?? null,
    ],
  });
}

describe("accounts Gmail OAuth binding", () => {
  beforeEach(async () => {
    testState.db = await createAuthTestDb();
    await seedOwner(currentDb(), { passwordHash: "unused-test-hash" });
    await seedSession(currentDb(), "cookie-session");
    await currentDb().execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: ["user-1"],
    });
    await currentDb().executeMultiple(`
      ALTER TABLE ea_instance_credentials ADD COLUMN pending_staged_at INTEGER;
      ALTER TABLE ea_instance_credentials ADD COLUMN pending_expires_at INTEGER;
    `);
    const staged = await googleOAuthCredentialManager.stageCandidate({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    testState.candidateVersions = staged.candidateVersions;
    gmailProvider.getAuthUrl.mockReset().mockImplementation(async (state: string) => (
      `https://accounts.example.test/oauth?state=${state}`
    ));
    gmailProvider.handleCallback.mockReset().mockImplementation(async (
      _code: string,
      _redirectUri: null,
      _userId: string,
      _credentials: { clientId: string; clientSecret: string },
      onValidated?: () => Promise<void>,
    ) => {
      await onValidated?.();
      return { email: "user@example.com", accountId: "gmail-user@example.com" };
    });
    gmailProvider.testConnection.mockReset();
    emailBackfillProcess.wakeEmailBackfillWorker.mockReset();
  });

  afterEach(async () => {
    await testState.db?.close?.();
    testState.db = null;
    testState.candidateVersions = null;
    vi.restoreAllMocks();
  });

  it("sets a short-lived OAuth bind cookie and stores the real candidate binding", async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/auth?label=Work")
      .set("Cookie", ["ea_session=cookie-session"]);


    const csrfResult = await currentDb().execute({
      sql: `SELECT token, account_label, expires_at, browser_bind_hash, oauth_user_id, oauth_label,
                   google_client_id_version, google_client_secret_version
            FROM ea_csrf_tokens`,
      args: [],
    });
    const credentialRows = await currentDb().execute({
      sql: "SELECT credential_key, pending_value_encrypted, version FROM ea_instance_credentials ORDER BY credential_key",
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/accounts\.example\.test\/oauth\?state=/);
    const cookieHeader = setCookieHeader(res);
    expect(cookieHeader).toContain("ea_oauth_bind=");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("HttpOnly");
    const rawBind = cookieHeader.match(/ea_oauth_bind=([^;]+)/)?.[1];
    if (!rawBind) throw new Error("expected OAuth bind cookie");
    expect(csrfResult.rows).toHaveLength(1);
    expect(csrfResult.rows[0]).toMatchObject({
      account_label: "user-1:Work",
      oauth_user_id: "user-1",
      oauth_label: "Work",
      google_client_id_version: testState.candidateVersions!.clientId,
      google_client_secret_version: testState.candidateVersions!.clientSecret,
      browser_bind_hash: crypto.createHash("sha256").update(rawBind).digest("hex"),
    });
    expect(csrfResult.rows[0]!.expires_at).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(credentialRows.rows).toEqual([
      expect.objectContaining({ credential_key: "google.oauth_client_id", pending_value_encrypted: expect.any(String) }),
      expect.objectContaining({ credential_key: "google.oauth_client_secret", pending_value_encrypted: expect.any(String) }),
    ]);
  });

  it("rejects callback when the browser bind cookie is missing and consumes the CSRF row", async () => {
    await seedCsrfToken({ token: "state-1", browserBind: "expected-bind", label: "Work" });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1");

    const csrfResult = await currentDb().execute({
      sql: "SELECT token FROM ea_csrf_tokens WHERE token = ?",
      args: ["state-1"],
    });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/binding missing/i);
    expect(csrfResult.rows).toHaveLength(0);
  });

  it("accepts a matching bind cookie, promotes credentials, labels the account, and queues durable backfill", async () => {
    await seedGmailAccount(currentDb(), { label: "Gmail", id: "gmail-user@example.com" });
    await seedCsrfToken({ token: "state-1", browserBind: "bind-cookie", label: "Work" });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    const accountResult = await currentDb().execute({
      sql: "SELECT label FROM ea_accounts WHERE id = ?",
      args: ["gmail-user@example.com"],
    });
    const csrfResult = await currentDb().execute({
      sql: "SELECT token FROM ea_csrf_tokens WHERE token = ?",
      args: ["state-1"],
    });
    const credentials = await currentDb().execute({
      sql: "SELECT credential_key, active_value_encrypted, pending_value_encrypted FROM ea_instance_credentials ORDER BY credential_key",
      args: [],
    });
    const backfill = await currentDb().execute({
      sql: "SELECT account_id, mailbox_scope, status FROM ea_email_backfill_state WHERE user_id = ?",
      args: ["user-1"],
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/settings?account_connected=user@example.com");
    expect(accountResult.rows[0]!.label).toBe("Work");
    expect(csrfResult.rows).toHaveLength(0);
    expect(credentials.rows).toEqual([
      expect.objectContaining({ credential_key: "google.oauth_client_id", active_value_encrypted: expect.any(String), pending_value_encrypted: null }),
      expect.objectContaining({ credential_key: "google.oauth_client_secret", active_value_encrypted: expect.any(String), pending_value_encrypted: null }),
    ]);
    expect(backfill.rows).toEqual([
      { account_id: "gmail-user@example.com", mailbox_scope: "inbox", status: "queued" },
    ]);
    expect(setCookieHeader(res)).toContain("ea_oauth_bind=;");
  });

  it("returns a generic message on callback failure without leaking provider details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    gmailProvider.handleCallback.mockRejectedValueOnce(
      new Error("invalid_grant: token exchange failed at https://oauth.internal/secret"),
    );
    await seedCsrfToken({ token: "state-1", browserBind: "bind-cookie", label: "Work" });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    expect(res.status).toBe(500);
    expect(res.text).toBe("OAuth failed. Please try connecting the account again.");
    expect(res.text).not.toMatch(/invalid_grant|oauth\.internal/);
    consoleError.mockRestore();
  });

  it("rejects a stale bound candidate before exchanging the authorization code", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await seedCsrfToken({ token: "state-1", browserBind: "bind-cookie", label: "Work" });
    await currentDb().execute({
      sql: "UPDATE ea_instance_credentials SET version = version + 1",
      args: [],
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?code=auth-code&state=state-1")
      .set("Cookie", ["ea_oauth_bind=bind-cookie"]);

    expect(res.status).toBe(500);
    expect(res.text).toBe("OAuth failed. Please try connecting the account again.");
    consoleError.mockRestore();
  });

  it("redacts provider error query details", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(makeApp())
      .get("/api/ea/accounts/gmail/callback?error=access_denied_secret_detail&state=state-1");

    expect(res.status).toBe(400);
    expect(res.text).toBe("Google OAuth was not completed. Please try again.");
    expect(res.text).not.toContain("secret_detail");
    consoleWarn.mockRestore();
  });

  it("returns needs_reauth status from the real account list", async () => {
    await seedGmailAccount(currentDb(), { id: "gmail-good", email: "good@example.com" });
    await seedGmailAccount(currentDb(), { id: "gmail-flagged", email: "flagged@example.com" });
    await currentDb().execute({
      sql: "UPDATE ea_accounts SET needs_reauth = 1 WHERE id = ?",
      args: ["gmail-flagged"],
    });

    const res = await request(makeApp())
      .get("/api/ea/accounts")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    const accounts = res.body as AccountSummary[];
    expect(accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gmail-good", needs_reauth: false }),
      expect.objectContaining({ id: "gmail-flagged", needs_reauth: true }),
    ]));
  });
});
