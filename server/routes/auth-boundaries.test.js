import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("../briefing/bills-service.js", () => ({
  sendBill: vi.fn(async () => ({ success: true })),
  markBillPaid: vi.fn(async () => ({ success: true })),
  listAccounts: vi.fn(async () => [{ id: "acct-1", name: "Checking" }]),
  listCategories: vi.fn(async () => [{ id: "cat-1", name: "Groceries" }]),
  listPayees: vi.fn(async () => [{ id: "payee-1", name: "Market" }]),
  getMetadata: vi.fn(async () => ({ accounts: [], categories: [], payees: [] })),
  testConnection: vi.fn(async () => ({ success: true })),
  createQuickTxn: vi.fn(async () => ({ success: true, account: "Checking" })),
  extractBill: vi.fn(async () => ({ payee: "Power", amount: 42 })),
}));
vi.mock("../briefing/lifecycle-service.js", () => ({
  triggerGeneration: vi.fn(),
  getInProgress: vi.fn(async () => ({ generating: false })),
  refresh: vi.fn(),
  getLatest: vi.fn(async () => ({ briefing: { id: "latest" } })),
  getHistory: vi.fn(),
  getStatus: vi.fn(),
  deleteBriefing: vi.fn(),
  getById: vi.fn(),
}));
vi.mock("../briefing/email-service.js", () => ({
  getEmailBody: vi.fn(),
  dismiss: vi.fn(),
  snooze: vi.fn(),
  wake: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  trash: vi.fn(),
  markAllRead: vi.fn(),
  searchEmails: vi.fn(),
}));
vi.mock("../briefing/tasks-service.js", () => ({
  completeTask: vi.fn(),
  dismissTombstone: vi.fn(),
  updateCTMStatus: vi.fn(),
  listProjects: vi.fn(async () => []),
  listLabels: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../briefing/dev-service.js", () => ({
  reindexEmails: vi.fn(),
}));
vi.mock("../briefing/email-index.js", () => ({
  getEmailIndexHealth: vi.fn(async () => ({ accounts: [] })),
  queueEmailIndexBackfill: vi.fn(async () => ({ queued: true, accounts: [] })),
}));
vi.mock("../briefing/email-backfill-worker.js", () => ({
  wakeEmailBackfillWorker: vi.fn(),
}));
vi.mock("../briefing/index.js", () => ({
  loadUserConfig: vi.fn(async () => ({ accounts: [], settings: {} })),
}));
vi.mock("../briefing/gmail.js", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  getAuthUrl: vi.fn(),
  handleCallback: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock("../briefing/icloud.js", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  testConnection: vi.fn(),
}));
vi.mock("../briefing/weather.js", () => ({
  fetchWeather: vi.fn(async () => ({ temp: 0, high: 0, low: 0, summary: "", hourly: [] })),
  geocodeLocation: vi.fn(async () => []),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: vi.fn(async () => []),
  getNextWeekRange: vi.fn(() => [0, 0]),
  getTomorrowRange: vi.fn(() => [0, 0]),
}));
vi.mock("../briefing/actual.js", () => ({
  getUpcomingBills: vi.fn(async () => []),
  getRecentTransactions: vi.fn(async () => []),
  getMetadata: vi.fn(async () => ({ schedules: [], payeeMap: {}, recentTransactions: [] })),
  isSchedulePaid: vi.fn(() => false),
}));
vi.mock("../briefing/scheduler.js", () => ({
  initScheduler: vi.fn(),
}));
vi.mock("../briefing/account-canonical.js", () => ({
  canonicalizeConfiguredAccounts: vi.fn((rows) => rows),
}));
vi.mock("../briefing/encryption.js", () => ({
  encrypt: vi.fn((value) => `enc:${value}`),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../briefing/bill-extractors/catalog.js", () => ({
  billExtractAvailability: vi.fn(() => []),
  isAllowedBillExtractModel: vi.fn(() => true),
  DEFAULT_BILL_EXTRACT_PROVIDER: "anthropic",
  DEFAULT_BILL_EXTRACT_MODEL: "haiku",
}));
vi.mock("../dashboard/current-service.js", () => ({
  getCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  getDashboardSystemHealth: vi.fn(async () => ({ providerHealth: {}, systemStatus: { state: "current", sources: [] } })),
  requestCurrentDashboardRefresh: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  syncCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
}));

process.env.EA_USER_ID = "user-1";

const { createQuickTxn, sendBill } = await import("../briefing/bills-service.js");
const briefingRoutes = (await import("./briefing/index.js")).default;
const dashboardRoutes = (await import("./dashboard.js")).default;
const liveRoutes = (await import("./live.js")).default;
const accountsRoutes = (await import("./accounts.js")).default;
const notesRoutes = (await import("./notes.js")).default;
const bearerHash = crypto.createHash("sha256").update("scoped-token").digest("hex");
const sessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/live", liveRoutes);
  app.use("/api/ea", accountsRoutes);
  app.use("/api/notes", notesRoutes);
  return app;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE ea_api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL,
      label TEXT,
      scopes TEXT NOT NULL,
      created_at INTEGER,
      last_used_at INTEGER,
      expires_at INTEGER
    );

    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      actual_budget_password_encrypted TEXT,
      todoist_api_token_encrypted TEXT,
      todoist_oauth_refresh_token_encrypted TEXT,
      todoist_oauth_access_token_expires_at TEXT,
      todoist_oauth_scope TEXT,
      todoist_oauth_token_type TEXT,
      schedules_json TEXT,
      email_interests_json TEXT,
      claude_model TEXT,
      email_ai_provider TEXT,
      email_ai_model TEXT,
      bill_extract_provider TEXT,
      bill_extract_model TEXT,
      email_triage_mode TEXT DEFAULT 'auto'
    );

    CREATE TABLE ea_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      content TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_settings (user_id, email_triage_mode) VALUES (?, ?)",
    args: ["user-1", "auto"],
  });
  return db;
}

async function seedSession(expiresAt = Date.now() + 60_000) {
  await testState.db.current.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [sessionHash, expiresAt],
  });
}

async function seedBearer(scopes = ["actual:write"]) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at)
          VALUES (?, ?, ?, ?, NULL)`,
    args: [bearerHash, "Shortcut", JSON.stringify(scopes), Date.now()],
  });
}

async function getSettingsRow() {
  const result = await testState.db.current.execute({
    sql: "SELECT * FROM ea_settings WHERE user_id = ?",
    args: ["user-1"],
  });
  return result.rows[0];
}

beforeEach(async () => {
  testState.db.current = await createMigratedDb();
  vi.clearAllMocks();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("auth boundaries", () => {
  it("blocks bearer auth on live route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on briefing latest route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/briefing/latest")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on dashboard current route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("does not expose retired briefing pin routes", async () => {
    await seedSession();
    const res = await request(makeApp())
      .post("/api/briefing/pin/msg-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(404);
  });

  it("blocks bearer auth on settings route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("omits retired embedding status from settings", async () => {
    await seedSession();
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("openai_available");
    expect(res.body).not.toHaveProperty("embedding_count");
  });

  it("returns stored and effective email triage mode from settings", async () => {
    await seedSession();
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.email_triage_mode).toBe("auto");
    expect(res.body.email_triage_effective_mode).toBe("no_model");
  });

  it("rejects invalid email triage mode writes", async () => {
    await seedSession();
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ email_triage_mode: "disabled" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email_triage_mode");
  });

  it("updates valid email triage mode writes", async () => {
    await seedSession();
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ email_triage_mode: "paused" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({ email_triage_mode: "paused" });
  });

  it("stores Todoist OAuth token responses without exposing token material", async () => {
    await seedSession();
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        todoist_oauth_token_response: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "data:read_write,data:delete",
        },
      });

    expect(res.status).toBe(200);
    const settings = await getSettingsRow();
    expect(settings).toMatchObject({
      todoist_api_token_encrypted: "enc:access-1",
      todoist_oauth_refresh_token_encrypted: "enc:refresh-1",
      todoist_oauth_token_type: "Bearer",
      todoist_oauth_scope: "data:read_write,data:delete",
    });
    expect(settings.todoist_oauth_access_token_expires_at).toEqual(expect.any(String));

    const getRes = await request(makeApp())
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(getRes.body.todoist_configured).toBe(true);
    expect(getRes.body.todoist_oauth_configured).toBe(true);
    expect(getRes.body).not.toHaveProperty("todoist_api_token_encrypted");
    expect(getRes.body).not.toHaveProperty("todoist_oauth_refresh_token_encrypted");
  });

  it("clears Todoist OAuth metadata when replacing with a personal token", async () => {
    await seedSession();
    await testState.db.current.execute({
      sql: `UPDATE ea_settings
            SET todoist_api_token_encrypted = ?,
                todoist_oauth_refresh_token_encrypted = ?,
                todoist_oauth_access_token_expires_at = ?,
                todoist_oauth_scope = ?,
                todoist_oauth_token_type = ?
            WHERE user_id = ?`,
      args: [
        "enc:access-1",
        "enc:refresh-1",
        "2026-05-04T21:00:00.000Z",
        "data:read_write",
        "Bearer",
        "user-1",
      ],
    });

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ todoist_api_token: "personal-token" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({
      todoist_api_token_encrypted: "enc:personal-token",
      todoist_oauth_refresh_token_encrypted: null,
      todoist_oauth_access_token_expires_at: null,
      todoist_oauth_scope: null,
      todoist_oauth_token_type: null,
    });
  });

  it("blocks bearer auth on notes route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/notes")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("allows scoped bearer auth on quick-txn", async () => {
    await seedBearer(["actual:write"]);
    const res = await request(makeApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Authorization", "Bearer scoped-token")
      .send({ account: "Checking", amount: 12.34, payee: "Coffee" });

    expect(res.status).toBe(200);
    expect(createQuickTxn).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accountName: "Checking", amount: 12.34, payee: "Coffee" }),
    );
  });

  it("allows cookie session auth on quick-txn", async () => {
    await seedSession();
    const res = await request(makeApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: 18.5, payee: "Lunch" });

    expect(res.status).toBe(200);
    expect(createQuickTxn).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accountName: "Checking", amount: 18.5, payee: "Lunch" }),
    );
  });

  it("allows transfer bill sends without a payee when transfer fields are present", async () => {
    await seedSession();
    const payload = {
      type: "transfer",
      amount: 197.5,
      due_date: "2026-04-30",
      from_account_id: "acct-checking",
      to_account_id: "acct-card",
      schedule_name: "Credit Card Payment",
    };

    const res = await request(makeApp())
      .post("/api/briefing/actual/send")
      .set("Cookie", ["ea_session=cookie-session"])
      .send(payload);

    expect(res.status).toBe(200);
    expect(sendBill).toHaveBeenCalledWith("user-1", expect.objectContaining(payload));
  });

  it("rejects transfer bill sends with missing transfer fields before calling Actual", async () => {
    await seedSession();
    const res = await request(makeApp())
      .post("/api/briefing/actual/send")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ type: "transfer", amount: 197.5, due_date: "2026-04-30", from_account_id: "acct-checking" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/from_account_id, to_account_id, and schedule_name/);
    expect(sendBill).not.toHaveBeenCalled();
  });

  it("keeps normal cookie session access on protected routes", async () => {
    await seedSession();
    const res = await request(makeApp())
      .get("/api/briefing/latest")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ briefing: { id: "latest" } });
  });

  it("rejects bearer auth on non-quick-txn bills endpoints", async () => {
    await seedBearer(["actual:write"]);
    const res = await request(makeApp())
      .get("/api/briefing/actual/metadata")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });
});
