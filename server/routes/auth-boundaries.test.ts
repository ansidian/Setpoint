import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClient,
  type Client,
  type InStatement,
  type TransactionMode,
} from "@libsql/client";
import type { Server } from "http";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
  },
}));
vi.mock("../bills/bills-service.ts", () => ({
  sendBill: vi.fn(async () => ({ success: true })),
  markBillPaid: vi.fn(async () => ({ success: true })),
  listAccounts: vi.fn(async () => [{ id: "acct-1", name: "Checking" }]),
  listCategories: vi.fn(async () => [{ id: "cat-1", name: "Groceries" }]),
  listPayees: vi.fn(async () => [{ id: "payee-1", name: "Market" }]),
  getMetadata: vi.fn(async () => ({ accounts: [], categories: [], payees: [] })),
  testConnection: vi.fn(async () => ({ success: true })),
  hydrateActualCache: vi.fn(async () => ({ success: true, hydrated: true })),
  getActualCacheStatus: vi.fn(async () => ({ success: true, hydrated: true })),
  createQuickTxn: vi.fn(async () => ({ success: true, account: "Checking" })),
  invalidateActualAfterTransactionImport: vi.fn(async () => undefined),
  extractBill: vi.fn(async () => ({ payee: "Power", amount: 42 })),
}));
vi.mock("../email/email-service.ts", () => ({
  getEmailBody: vi.fn(),
  dismiss: vi.fn(),
  snooze: vi.fn(),
  wake: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  trash: vi.fn(),
  markAllRead: vi.fn(),
  searchEmails: vi.fn(),
  settleArrivalGrace: vi.fn(async () => ({ settled: 2, emailIds: ["msg-1", "msg-2"] })),
}));
vi.mock("../tasks/tasks-service.ts", () => ({
  completeTask: vi.fn(),
  dismissTombstone: vi.fn(),
  updateCTMStatus: vi.fn(),
  listProjects: vi.fn(async () => []),
  listLabels: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../email/dev-service.ts", () => ({
  reindexEmails: vi.fn(),
}));
vi.mock("../email/email-index.ts", () => ({
  getEmailIndexHealth: vi.fn(async () => ({ accounts: [] })),
  queueEmailIndexBackfill: vi.fn(async () => ({ queued: true, accounts: [] })),
}));
vi.mock("../email/email-backfill-worker.ts", () => ({
  wakeEmailBackfillWorker: vi.fn(),
}));
vi.mock("../platform/weather.ts", () => ({
  fetchWeather: vi.fn(async () => ({ temp: 0, high: 0, low: 0, summary: "", hourly: [] })),
  geocodeLocation: vi.fn(async () => []),
}));
vi.mock("../scheduler.ts", () => ({
  initScheduler: vi.fn(),
}));
vi.mock("../platform/encryption.ts", () => ({
  encrypt: vi.fn((value) => `enc:${value}`),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../capability-status-service.ts", () => ({
  capabilityStatusService: { invalidate: vi.fn() },
}));
vi.mock("../reminders/discord-reminders.ts", () => ({
  formatGenericDiscordTestPayload: vi.fn(() => ({ embeds: [{ title: "Setpoint reminder test" }] })),
  sendDiscordWebhook: vi.fn(async () => ({ ok: true, status: 204 })),
}));
vi.mock("../bills/bill-extractors/catalog.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  billExtractAvailability: vi.fn(() => []),
  isAllowedBillExtractModel: vi.fn(() => true),
}));
vi.mock("../dashboard/current-service.ts", () => ({
  applyDeadlineCurrentStatus: vi.fn(async () => ({ updated: true })),
  getCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  getDashboardSystemHealth: vi.fn(async () => ({ providerHealth: {}, systemStatus: { state: "current", sources: [] } })),
  requestCurrentDashboardRefresh: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  syncCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
}));

process.env.EA_USER_ID = "user-1";

const { createQuickTxn } = await import("../bills/bills-service.ts");
const emailService = await import("../email/email-service.ts");
const briefingRoutes = (await import("./briefing/index.ts")).default;
const dashboardRoutes = (await import("./dashboard.ts")).default;
const settingsRoutes = (await import("./settings.ts")).default;
const remindersRoutes = (await import("./reminders.ts")).default;
const notesRoutes = (await import("./notes.ts")).default;
const { requireCookieSession } = await import("../middleware/auth.ts");
const discordReminders = await import("../reminders/discord-reminders.ts");
const {
  clearCurrentDashboardEventSubscribers,
} = await import("../dashboard/current-events.ts");
const bearerHash = crypto.createHash("sha256").update("scoped-token").digest("hex");
const sessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/ea", requireCookieSession, settingsRoutes, remindersRoutes);
  app.use("/api/notes", notesRoutes);
  return app;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_owner (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      user_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'password_or_passkey',
      security_generation INTEGER NOT NULL DEFAULT 1,
      claimed_at INTEGER NOT NULL
    );

    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      authenticated_at INTEGER NOT NULL DEFAULT 0,
      password_authenticated_at INTEGER NOT NULL DEFAULT 0,
      security_generation INTEGER NOT NULL DEFAULT 1,
      auth_method TEXT NOT NULL DEFAULT 'password',
      step_up_failure_count INTEGER NOT NULL DEFAULT 0,
      step_up_blocked_until INTEGER NOT NULL DEFAULT 0,
      step_up_window_started_at INTEGER NOT NULL DEFAULT 0
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
      todoist_connection_mode TEXT,
      todoist_needs_reauth INTEGER NOT NULL DEFAULT 0,
      discord_webhook_url_encrypted TEXT,
      discord_user_id TEXT,
      schedules_json TEXT,
      email_interests_json TEXT,
      email_ai_provider TEXT,
      email_ai_model TEXT,
      bill_extract_provider TEXT,
      bill_extract_model TEXT,
      email_triage_mode TEXT DEFAULT 'auto',
      triage_sound_settings_json TEXT,
      bill_pay_mappings_json TEXT
    );

    CREATE TABLE ea_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_account_id TEXT,
      source_calendar_id TEXT,
      source_item_id TEXT NOT NULL,
      source_occurrence_id TEXT,
      anchor_kind TEXT NOT NULL,
      anchor_at TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      missed_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT,
      last_error TEXT,
      payload_snapshot_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_email_triage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email_id TEXT NOT NULL,
      triage_source TEXT,
      last_triaged_at TEXT,
      model_usage_json TEXT,
      cheap_model_result_json TEXT,
      strong_model_result_json TEXT
    );

    CREATE TABLE ea_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      content TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
  await db.execute({
    sql: `INSERT INTO ea_owner
            (singleton_id, user_id, password_hash, auth_mode, security_generation, claimed_at)
          VALUES (1, ?, ?, 'password_or_passkey', 1, ?)`,
    args: ["user-1", "test-password-hash", Date.now()],
  });
  await db.execute({
    sql: "INSERT INTO ea_settings (user_id, email_triage_mode) VALUES (?, ?)",
    args: ["user-1", "auto"],
  });
  return db;
}

async function seedSession(expiresAt = Date.now() + 60_000) {
  await currentDb().execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [sessionHash, expiresAt],
  });
}

async function seedRecentPasswordSession() {
  const now = Date.now();
  await currentDb().execute({
    sql: `INSERT INTO ea_sessions
            (token, expires_at, authenticated_at, password_authenticated_at, auth_method)
          VALUES (?, ?, ?, ?, 'password')`,
    args: [sessionHash, now + 60_000, now, now],
  });
}

async function seedBearer(scopes: string[] = ["actual:write"]) {
  // Mirror production token creation (server/routes/auth.ts) with a live
  // expires_at; validateBearer now fails closed on NULL/expired rows.
  await currentDb().execute({
    sql: `INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [bearerHash, "Shortcut", JSON.stringify(scopes), Date.now(), Date.now() + 60_000],
  });
}

async function getSettingsRow() {
  const result = await currentDb().execute({
    sql: "SELECT * FROM ea_settings WHERE user_id = ?",
    args: ["user-1"],
  });
  return result.rows[0];
}

// One shared listening server for the whole file instead of request(server)
// per call. The app is stateless across tests (routers delegate to mocked deps +
// the per-test testState.db.current), so reuse is safe — and it removes ~26
// app.listen(0)/close cycles that, under full-suite fork contention, can starve
// the event loop into a "socket hang up" before a response lands.
let server: Server;
beforeAll(() => {
  server = makeApp().listen(0);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  testState.db.current = await createMigratedDb();
  clearCurrentDashboardEventSubscribers();
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  clearCurrentDashboardEventSubscribers();
  testState.db.current?.close();
  testState.db.current = null;
});

describe("auth boundaries", () => {
  it("blocks bearer auth on operational briefing routes", async () => {
    await seedBearer();
    const res = await request(server)
      .get("/api/briefing/email-index/health")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on dashboard current route", async () => {
    await seedBearer();
    const res = await request(server)
      .get("/api/dashboard/current")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("does not expose briefing pin routes", async () => {
    await seedSession();
    const res = await request(server)
      .post("/api/briefing/pin/msg-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(404);
  });

  it("settles arrival-grace rows through the authenticated briefing endpoint", async () => {
    await seedSession();
    const res = await request(server)
      .post("/api/briefing/email/arrival-grace/settle")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, settled: 2, emailIds: ["msg-1", "msg-2"] });
    expect(emailService.settleArrivalGrace).toHaveBeenCalledWith("user-1");
  });

  it("blocks bearer auth on settings route", async () => {
    await seedBearer();
    const res = await request(server)
      .get("/api/ea/settings")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("omits embedding status from settings", async () => {
    await seedSession();
    const res = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("openai_available");
    expect(res.body).not.toHaveProperty("embedding_count");
  });

  it("returns stored and effective email triage mode from settings", async () => {
    await seedSession();
    const res = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.email_triage_mode).toBe("auto");
    expect(res.body.email_triage_effective_mode).toBe("no_model");
  });

  it("stores Todoist OAuth token responses without exposing token material", async () => {
    await seedSession();
    const res = await request(server)
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
      todoist_connection_mode: "oauth",
      todoist_needs_reauth: 0,
    });
    expect(settings!.todoist_oauth_access_token_expires_at).toEqual(expect.any(String));

    const getRes = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(getRes.body.todoist_configured).toBe(true);
    expect(getRes.body.todoist_oauth_configured).toBe(true);
    expect(getRes.body).not.toHaveProperty("todoist_api_token_encrypted");
    expect(getRes.body).not.toHaveProperty("todoist_oauth_refresh_token_encrypted");
  });

  it("rejects generic Todoist replacement so OAuth metadata cannot be bypassed", async () => {
    await seedSession();
    await currentDb().execute({
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

    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ todoist_api_token: "personal-token" });

    expect(res.status).toBe(400);
    expect(await getSettingsRow()).toMatchObject({
      todoist_api_token_encrypted: "enc:access-1",
      todoist_oauth_refresh_token_encrypted: "enc:refresh-1",
      todoist_oauth_access_token_expires_at: "2026-05-04T21:00:00.000Z",
      todoist_oauth_scope: "data:read_write",
      todoist_oauth_token_type: "Bearer",
    });
  });

  it("stores Discord webhook settings encrypted without exposing the raw webhook", async () => {
    await seedRecentPasswordSession();
    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        discord_webhook_url: "https://discord.com/api/webhooks/1/webhook",
        discord_user_id: "123456789",
      });

    expect(res.status).toBe(200);
    const settings = await getSettingsRow();
    expect(settings).toMatchObject({
      discord_webhook_url_encrypted: "enc:https://discord.com/api/webhooks/1/webhook",
      discord_user_id: "123456789",
    });

    const getRes = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(getRes.status).toBe(200);
    expect(getRes.body.discord_webhook_configured).toBe(true);
    expect(getRes.body.discord_user_id).toBe("123456789");
    expect(getRes.body).not.toHaveProperty("discord_webhook_url");
    expect(getRes.body).not.toHaveProperty("discord_webhook_url_encrypted");
  });

  it("clears Discord webhook settings", async () => {
    await seedRecentPasswordSession();
    await currentDb().execute({
      sql: `UPDATE ea_settings
            SET discord_webhook_url_encrypted = ?,
                discord_user_id = ?
            WHERE user_id = ?`,
      args: ["enc:https://discord.example/webhook", "123", "user-1"],
    });

    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ discord_webhook_url: "", discord_user_id: "" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({
      discord_webhook_url_encrypted: null,
      discord_user_id: null,
    });
  });

  it("sends a generic Discord reminder test through the stored webhook", async () => {
    await seedSession();
    await currentDb().execute({
      sql: `UPDATE ea_settings
            SET discord_webhook_url_encrypted = ?,
                discord_user_id = ?
            WHERE user_id = ?`,
      args: ["enc:https://discord.example/webhook", "123", "user-1"],
    });

    const res = await request(server)
      .post("/api/ea/settings/discord-reminder-test")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 204 });
    expect(discordReminders.formatGenericDiscordTestPayload).toHaveBeenCalledWith({
      discordUserId: "123",
    });
    expect(discordReminders.sendDiscordWebhook).toHaveBeenCalledWith(
      "enc:https://discord.example/webhook",
      { embeds: [{ title: "Setpoint reminder test" }] },
    );
  });

  it("blocks bearer auth on notes route", async () => {
    await seedBearer();
    const res = await request(server)
      .get("/api/notes")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("allows scoped bearer auth on quick-txn", async () => {
    await seedBearer(["actual:write"]);
    const res = await request(server)
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
    const res = await request(server)
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: 18.5, payee: "Lunch" });

    expect(res.status).toBe(200);
    expect(createQuickTxn).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accountName: "Checking", amount: 18.5, payee: "Lunch" }),
    );
  });

  it("does not expose briefing lifecycle or history routes to cookie sessions", async () => {
    await seedSession();
    const cases = [
      ["post", "/api/briefing/generate"],
      ["get", "/api/briefing/in-progress"],
      ["post", "/api/briefing/refresh"],
      ["get", "/api/briefing/latest"],
      ["get", "/api/briefing/history"],
      ["get", "/api/briefing/status/123"],
      ["get", "/api/briefing/123"],
      ["delete", "/api/briefing/123"],
    ] as const;

    for (const [method, path] of cases) {
      const agent = request(server);
      const res = await agent[method](path)
        .set("Cookie", ["ea_session=cookie-session"]);

      expect(res.status).toBe(404);
    }
  });

  it("rejects bearer auth on non-quick-txn bills endpoints", async () => {
    await seedBearer(["actual:write"]);
    const cases = [
      ["get", "/api/briefing/actual/metadata"],
      ["get", "/api/briefing/actual/cache/status"],
      ["post", "/api/briefing/actual/cache/hydrate"],
    ] as const;

    for (const [method, path] of cases) {
      const res = await request(server)[method](path)
        .set("Authorization", "Bearer scoped-token");

      expect(res.status).toBe(401);
    }
  });
});
