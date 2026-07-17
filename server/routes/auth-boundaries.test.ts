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
vi.mock("../email/gmail.ts", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  getAuthUrl: vi.fn(),
  handleCallback: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock("../email/icloud.ts", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  testConnection: vi.fn(),
}));
vi.mock("../platform/weather.ts", () => ({
  fetchWeather: vi.fn(async () => ({ temp: 0, high: 0, low: 0, summary: "", hourly: [] })),
  geocodeLocation: vi.fn(async () => []),
}));
vi.mock("../calendar/calendar.ts", () => ({
  fetchCalendar: vi.fn(async () => []),
  getNextWeekRange: vi.fn(() => [0, 0]),
  getTomorrowRange: vi.fn(() => [0, 0]),
}));
vi.mock("../actual/actual.ts", () => ({
  getUpcomingBills: vi.fn(async () => []),
  getRecentTransactions: vi.fn(async () => []),
  getMetadata: vi.fn(async () => ({ schedules: [], payeeMap: {}, recentTransactions: [] })),
  isSchedulePaid: vi.fn(() => false),
}));
vi.mock("../scheduler.ts", () => ({
  initScheduler: vi.fn(),
}));
vi.mock("../platform/account-canonical.ts", () => ({
  canonicalizeConfiguredAccounts: vi.fn((rows) => rows),
}));
vi.mock("../platform/encryption.ts", () => ({
  encrypt: vi.fn((value) => `enc:${value}`),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../reminders/discord-reminders.ts", () => ({
  formatGenericDiscordTestPayload: vi.fn(() => ({ embeds: [{ title: "Setpoint reminder test" }] })),
  sendDiscordWebhook: vi.fn(async () => ({ ok: true, status: 204 })),
}));
vi.mock("../bills/bill-extractors/catalog.ts", () => ({
  billExtractAvailability: vi.fn(() => []),
  isAllowedBillExtractModel: vi.fn(() => true),
  DEFAULT_BILL_EXTRACT_PROVIDER: "anthropic",
  DEFAULT_BILL_EXTRACT_MODEL: "haiku",
}));
vi.mock("../dashboard/current-service.js", () => ({
  applyDeadlineCurrentStatus: vi.fn(async () => ({ updated: true })),
  getCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  getDashboardSystemHealth: vi.fn(async () => ({ providerHealth: {}, systemStatus: { state: "current", sources: [] } })),
  requestCurrentDashboardRefresh: vi.fn(async () => ({ weather: null, providerHealth: {} })),
  syncCurrentDashboard: vi.fn(async () => ({ weather: null, providerHealth: {} })),
}));

process.env.EA_USER_ID = "user-1";

const { createQuickTxn, sendBill } = await import("../bills/bills-service.ts");
const emailService = await import("../email/email-service.ts");
const briefingRoutes = (await import("./briefing/index.js")).default;
const dashboardRoutes = (await import("./dashboard.js")).default;
const accountsRoutes = (await import("./accounts.ts")).default;
const notesRoutes = (await import("./notes.ts")).default;
const discordReminders = await import("../reminders/discord-reminders.ts");
const {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} = await import("../dashboard/current-events.js");
const { TRIAGE_NOTIFICATION_SOUNDS } = await import("../triage/triage-sound-settings.ts");
const bearerHash = crypto.createHash("sha256").update("scoped-token").digest("hex");
const sessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
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
  __resetCurrentDashboardEventsForTests();
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  __resetCurrentDashboardEventsForTests();
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

  it("returns default triage sound settings and the bundled sound registry", async () => {
    await seedSession();
    const res = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.triage_sound_settings).toEqual({
      laneScope: "needs_attention_and_fyi",
      volume: 1,
      triggers: {
        needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
        email_queued: { enabled: true, soundId: "quick_chime" },
        fyi_finalized: { enabled: true, soundId: "smooth_modern" },
        weak_security_grace: { enabled: true, soundId: "low_tone" },
        triage_failed: { enabled: false, soundId: "low_tone" },
        event_upcoming: { enabled: true, soundId: "clear_chime" },
        task_completed: { enabled: true, soundId: "smooth_modern" },
      },
    });
    expect(res.body.triage_notification_sounds).toEqual(TRIAGE_NOTIFICATION_SOUNDS);
  });

  it("returns default Bill Pay mappings from settings", async () => {
    await seedSession();
    const res = await request(server)
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.bill_pay_mappings).toEqual({ version: 1, profiles: [] });
  });

  it("serves triage cache stats over the authed diagnostic route", async () => {
    // Thin wiring check: the route reaches getTriageCacheStats and returns its
    // summary shape. The pricing/window/rounding math lives in
    // server/triage/triage-cache-stats.test.ts.
    await seedSession();
    await currentDb().execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, email_id, triage_source, last_triaged_at, model_usage_json, strong_model_result_json)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        "user-1",
        "strong-1",
        "strong_model",
        new Date().toISOString(),
        JSON.stringify({
          strong: {
            input_tokens: 2000,
            output_tokens: 200,
            input_tokens_details: { cached_tokens: 1000 },
          },
        }),
        JSON.stringify({ provider: "openai", model: "gpt-5.4", tier: "strong" }),
      ],
    });

    const res = await request(server)
      .get("/api/ea/triage/cache-stats")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(7);
    expect(res.body.openaiCalls).toBe(1);
    expect(res.body.comparisonWindows.monthToDate).toBeTruthy();
  });

  it("requires a session for GET /api/ea/email-search/usage", async () => {
    const res = await request(server).get("/api/ea/email-search/usage");
    expect(res.status).toBe(401);
  });

  it("returns email-search usage for an authed session", async () => {
    await seedSession();
    const res = await request(server)
      .get("/api/ea/email-search/usage")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(res.status).toBe(200);
    // Honest shape: querySearch present, no askAi/planner bolt-on.
    expect(res.body.querySearch).toBeTruthy();
    expect(res.body.askAi).toBeUndefined();
  });

  it("rejects invalid email triage mode writes", async () => {
    await seedSession();
    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ email_triage_mode: "disabled" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email_triage_mode");
  });

  it("updates valid email triage mode writes", async () => {
    await seedSession();
    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ email_triage_mode: "paused" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({ email_triage_mode: "paused" });
  });

  it("rejects invalid triage sound settings without touching the stored row", async () => {
    // Wiring check: validateTriageSoundSettings gates the write (400) and the
    // durable row is left unwritten. The per-branch validation messages are
    // owned by server/triage/triage-sound-settings.test.ts.
    await seedSession();
    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        triage_sound_settings: {
          laneScope: "all_mail",
          triggers: {
            needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
          },
        },
      });

    expect(res.status).toBe(400);
    expect((await getSettingsRow())!.triage_sound_settings_json).toBeNull();
  });

  it("updates valid triage sound settings writes", async () => {
    await seedSession();
    const settings = {
      laneScope: "needs_attention_only",
      volume: 0.85,
      triggers: {
        needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
        email_queued: { enabled: true, soundId: "quick_chime" },
        fyi_finalized: { enabled: false, soundId: "smooth_modern" },
        weak_security_grace: { enabled: true, soundId: "low_tone" },
        triage_failed: { enabled: true, soundId: "low_tone" },
        event_upcoming: { enabled: true, soundId: "clear_chime" },
        task_completed: { enabled: true, soundId: "smooth_modern" },
      },
    };

    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ triage_sound_settings: settings });

    expect(res.status).toBe(200);
    expect(JSON.parse(String((await getSettingsRow())!.triage_sound_settings_json))).toEqual(settings);
  });

  it("rejects invalid Bill Pay mapping settings", async () => {
    await seedSession();
    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        bill_pay_mappings: {
          version: 1,
          profiles: [{ id: "empty", enabled: true, behaviors: [] }],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Enabled bill_pay_mappings profile requires identity matchers");
  });

  it("updates valid Bill Pay mapping settings writes", async () => {
    await seedSession();
    const mappings = {
      version: 1,
      profiles: [{
        id: "edison",
        enabled: true,
        identity: { aliases: ["edison"] },
        behaviors: [{
          id: "monthly",
          enabled: true,
          type: "expense",
          intent: { subject: ["bill"] },
          targets: { payee_id: "payee-edison", payee_label: "Southern California Edison" },
        }],
      }],
    };

    const res = await request(server)
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ bill_pay_mappings: mappings });

    expect(res.status).toBe(200);
    expect(JSON.parse(String((await getSettingsRow())!.bill_pay_mappings_json))).toEqual(mappings);
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

  it("clears Todoist OAuth metadata when replacing with a personal token", async () => {
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

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({
      todoist_api_token_encrypted: "enc:personal-token",
      todoist_oauth_refresh_token_encrypted: null,
      todoist_oauth_access_token_expires_at: null,
      todoist_oauth_scope: null,
      todoist_oauth_token_type: null,
    });
  });

  it("stores Discord webhook settings encrypted without exposing the raw webhook", async () => {
    await seedSession();
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
    await seedSession();
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

  it("reports missing and rate-limited Discord reminder tests", async () => {
    await seedSession();
    const missing = await request(server)
      .post("/api/ea/settings/discord-reminder-test")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("Discord webhook not configured");

    await currentDb().execute({
      sql: "UPDATE ea_settings SET discord_webhook_url_encrypted = ? WHERE user_id = ?",
      args: ["enc:https://discord.example/webhook", "user-1"],
    });
    vi.mocked(discordReminders.sendDiscordWebhook).mockResolvedValueOnce({
      ok: false,
      status: 429,
      rateLimited: true,
      retryAfterMs: 2500,
      error: "Discord 429",
    });

    const limited = await request(server)
      .post("/api/ea/settings/discord-reminder-test")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("3");
    expect(limited.body.message).toBe("Discord webhook rate limited");
  });

  it("creates, lists, and deletes reminder rows through authenticated routes", async () => {
    await seedSession();
    const dashboardEvents: unknown[] = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event: unknown) => {
      dashboardEvents.push(event);
    });
    const createRes = await request(server)
      .post("/api/ea/reminders")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        sourceType: "calendar_event",
        sourceAccountId: "gmail-1",
        sourceCalendarId: "primary",
        sourceItemId: "event-1",
        anchorKind: "event_start",
        anchorAt: "2026-05-10T17:00:00.000Z",
        offsetMinutes: -15,
        payloadSnapshot: { title: "Dentist" },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.reminder).toMatchObject({
      user_id: "user-1",
      source_type: "calendar_event",
      source_item_id: "event-1",
      remind_at: "2026-05-10T16:45:00.000Z",
    });

    const listRes = await request(server)
      .get("/api/ea/reminders?sourceType=calendar_event&sourceItemId=event-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(listRes.status).toBe(200);
    expect(listRes.body.reminders).toHaveLength(1);

    const deleteRes = await request(server)
      .delete(`/api/ea/reminders/${createRes.body.reminder.id}`)
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ success: true });
    unsubscribe();
    expect(dashboardEvents).toEqual([
      expect.objectContaining({
        source: "reminders",
        reason: "reminder_created",
        details: expect.objectContaining({
          sourceType: "calendar_event",
          sourceItemId: "event-1",
        }),
      }),
      expect.objectContaining({
        source: "reminders",
        reason: "reminder_deleted",
        details: expect.objectContaining({
          reminderId: createRes.body.reminder.id,
        }),
      }),
    ]);
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

  it("rejects non-numeric quick-txn amounts before calling Actual", async () => {
    await seedBearer(["actual:write"]);
    const res = await request(server)
      .post("/api/briefing/actual/quick-txn")
      .set("Authorization", "Bearer scoped-token")
      .send({ account: "Checking", amount: "$12.34", payee: "Coffee" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("amount must be a number");
    expect(createQuickTxn).not.toHaveBeenCalled();
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

    const res = await request(server)
      .post("/api/briefing/actual/send")
      .set("Cookie", ["ea_session=cookie-session"])
      .send(payload);

    expect(res.status).toBe(200);
    expect(sendBill).toHaveBeenCalledWith("user-1", expect.objectContaining(payload));
  });

  it("rejects transfer bill sends with missing transfer fields before calling Actual", async () => {
    await seedSession();
    const res = await request(server)
      .post("/api/briefing/actual/send")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ type: "transfer", amount: 197.5, due_date: "2026-04-30", from_account_id: "acct-checking" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/from_account_id, to_account_id, and schedule_name/);
    expect(sendBill).not.toHaveBeenCalled();
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
