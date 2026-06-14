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
vi.mock("../bills/bills-service.js", () => ({
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
vi.mock("../email/email-service.js", () => ({
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
vi.mock("../tasks/tasks-service.js", () => ({
  completeTask: vi.fn(),
  dismissTombstone: vi.fn(),
  updateCTMStatus: vi.fn(),
  listProjects: vi.fn(async () => []),
  listLabels: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../email/dev-service.js", () => ({
  reindexEmails: vi.fn(),
}));
vi.mock("../email/email-index.js", () => ({
  getEmailIndexHealth: vi.fn(async () => ({ accounts: [] })),
  queueEmailIndexBackfill: vi.fn(async () => ({ queued: true, accounts: [] })),
}));
vi.mock("../email/email-backfill-worker.js", () => ({
  wakeEmailBackfillWorker: vi.fn(),
}));
vi.mock("../email/gmail.js", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  getAuthUrl: vi.fn(),
  handleCallback: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock("../email/icloud.js", () => ({
  fetchEmails: vi.fn(async () => []),
  isMessageRead: vi.fn(async () => null),
  testConnection: vi.fn(),
}));
vi.mock("../platform/weather.js", () => ({
  fetchWeather: vi.fn(async () => ({ temp: 0, high: 0, low: 0, summary: "", hourly: [] })),
  geocodeLocation: vi.fn(async () => []),
}));
vi.mock("../calendar/calendar.js", () => ({
  fetchCalendar: vi.fn(async () => []),
  getNextWeekRange: vi.fn(() => [0, 0]),
  getTomorrowRange: vi.fn(() => [0, 0]),
}));
vi.mock("../actual/actual.js", () => ({
  getUpcomingBills: vi.fn(async () => []),
  getRecentTransactions: vi.fn(async () => []),
  getMetadata: vi.fn(async () => ({ schedules: [], payeeMap: {}, recentTransactions: [] })),
  isSchedulePaid: vi.fn(() => false),
}));
vi.mock("../scheduler.js", () => ({
  initScheduler: vi.fn(),
}));
vi.mock("../platform/account-canonical.js", () => ({
  canonicalizeConfiguredAccounts: vi.fn((rows) => rows),
}));
vi.mock("../platform/encryption.js", () => ({
  encrypt: vi.fn((value) => `enc:${value}`),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../reminders/discord-reminders.js", () => ({
  formatGenericDiscordTestPayload: vi.fn(() => ({ embeds: [{ title: "Setpoint reminder test" }] })),
  sendDiscordWebhook: vi.fn(async () => ({ ok: true, status: 204 })),
}));
vi.mock("../bills/bill-extractors/catalog.js", () => ({
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

const { createQuickTxn, sendBill } = await import("../bills/bills-service.js");
const emailService = await import("../email/email-service.js");
const briefingRoutes = (await import("./briefing/index.js")).default;
const dashboardRoutes = (await import("./dashboard.js")).default;
const accountsRoutes = (await import("./accounts.js")).default;
const notesRoutes = (await import("./notes.js")).default;
const discordReminders = await import("../reminders/discord-reminders.js");
const {
  __resetCurrentDashboardEventsForTests,
  subscribeCurrentDashboardEvents,
} = await import("../dashboard/current-events.js");
const { TRIAGE_NOTIFICATION_SOUNDS } = await import("../triage/triage-sound-settings.js");
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
  __resetCurrentDashboardEventsForTests();
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  __resetCurrentDashboardEventsForTests();
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("auth boundaries", () => {
  it("blocks bearer auth on operational briefing routes", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/briefing/email-index/health")
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

  it("does not expose briefing pin routes", async () => {
    await seedSession();
    const res = await request(makeApp())
      .post("/api/briefing/pin/msg-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(404);
  });

  it("settles arrival-grace rows through the authenticated briefing endpoint", async () => {
    await seedSession();
    const res = await request(makeApp())
      .post("/api/briefing/email/arrival-grace/settle")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, settled: 2, emailIds: ["msg-1", "msg-2"] });
    expect(emailService.settleArrivalGrace).toHaveBeenCalledWith("user-1");
  });

  it("blocks bearer auth on settings route", async () => {
    await seedBearer();
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("omits embedding status from settings", async () => {
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

  it("returns default triage sound settings and the bundled sound registry", async () => {
    await seedSession();
    const res = await request(makeApp())
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
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.bill_pay_mappings).toEqual({ version: 1, profiles: [] });
  });

  it("returns OpenAI triage cache stats for the recent settings diagnostic", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
    await seedSession();
    await testState.db.current.batch([
      {
        sql: `INSERT INTO ea_email_triage
                (user_id, email_id, triage_source, last_triaged_at, model_usage_json, cheap_model_result_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "user-1",
          "cheap-1",
          "cheap_model",
          "2026-05-04T12:00:00.000Z",
          JSON.stringify({
            cheap: {
              input_tokens: 1000,
              output_tokens: 100,
              prompt_tokens_details: { cached_tokens: 600 },
            },
          }),
          JSON.stringify({ provider: "openai", model: "gpt-5.4-nano-2026-05-04", tier: "cheap" }),
        ],
      },
      {
        sql: `INSERT INTO ea_email_triage
                (user_id, email_id, triage_source, last_triaged_at, model_usage_json, strong_model_result_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "user-1",
          "strong-1",
          "strong_model",
          "2026-05-04T12:05:00.000Z",
          JSON.stringify({
            strong: {
              input_tokens: 2000,
              output_tokens: 200,
              input_tokens_details: { cached_tokens: 1000 },
            },
          }),
          JSON.stringify({ provider: "openai", model: "gpt-5.4", tier: "strong" }),
        ],
      },
      {
        sql: `INSERT INTO ea_email_triage
                (user_id, email_id, triage_source, last_triaged_at, model_usage_json, cheap_model_result_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "user-1",
          "anthropic-1",
          "cheap_model",
          "2026-05-04T12:10:00.000Z",
          JSON.stringify({ cheap: { input_tokens: 999, output_tokens: 99 } }),
          JSON.stringify({ provider: "anthropic", model: "claude-haiku-4-5-20251001", tier: "cheap" }),
        ],
      },
    ]);

    const res = await request(makeApp())
      .get("/api/ea/triage/cache-stats")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      windowDays: 7,
      openaiCalls: 2,
      inputTokens: 3000,
      cachedInputTokens: 1600,
      outputTokens: 300,
      estimatedCostUsd: 0.005967,
      hitRate: 0.5333,
      lastTriagedAt: "2026-05-04T12:05:00.000Z",
      comparisonWindows: {
        monthToDate: {
          windowDays: null,
          windowLabel: "month_to_date",
          openaiCalls: 2,
          estimatedCostUsd: 0.005967,
          estimatedSavingsUsd: 0.002358,
        },
      },
      byTier: {
        cheap: {
          calls: 1,
          inputTokens: 1000,
          cachedInputTokens: 600,
          outputTokens: 100,
          estimatedCostUsd: 0.000217,
        },
        strong: {
          calls: 1,
          inputTokens: 2000,
          cachedInputTokens: 1000,
          outputTokens: 200,
          estimatedCostUsd: 0.00575,
        },
      },
    });
    expect(res.body.estimatedSavingsUsd).toBeCloseTo(0.002358, 6);
    expect(res.body.semanticSearch).toBeUndefined();

    const semanticRes = await request(makeApp())
      .get("/api/ea/triage/cache-stats?semantic=1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(semanticRes.status).toBe(200);
    expect(semanticRes.body.semanticSearch).toMatchObject({
      coverage: {
        semantic_status: "unavailable",
      },
    });
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

  it("rejects invalid triage sound settings", async () => {
    await seedSession();
    const res = await request(makeApp())
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
    expect(res.body.message).toBe("Invalid triage_sound_settings laneScope");

    const soundRes = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        triage_sound_settings: {
          laneScope: "needs_attention_and_fyi",
          triggers: {
            needs_attention_finalized: { enabled: true, soundId: "linear-upload-file" },
          },
        },
      });

    expect(soundRes.status).toBe(400);
    expect(soundRes.body.message).toBe("Invalid triage_sound_settings soundId");
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

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ triage_sound_settings: settings });

    expect(res.status).toBe(200);
    expect(JSON.parse((await getSettingsRow()).triage_sound_settings_json)).toEqual(settings);
  });

  it("rejects invalid Bill Pay mapping settings", async () => {
    await seedSession();
    const res = await request(makeApp())
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

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ bill_pay_mappings: mappings });

    expect(res.status).toBe(200);
    expect(JSON.parse((await getSettingsRow()).bill_pay_mappings_json)).toEqual(mappings);
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

  it("stores Discord webhook settings encrypted without exposing the raw webhook", async () => {
    await seedSession();
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        discord_webhook_url: "https://discord.example/webhook",
        discord_user_id: "123456789",
      });

    expect(res.status).toBe(200);
    const settings = await getSettingsRow();
    expect(settings).toMatchObject({
      discord_webhook_url_encrypted: "enc:https://discord.example/webhook",
      discord_user_id: "123456789",
    });

    const getRes = await request(makeApp())
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
    await testState.db.current.execute({
      sql: `UPDATE ea_settings
            SET discord_webhook_url_encrypted = ?,
                discord_user_id = ?
            WHERE user_id = ?`,
      args: ["enc:https://discord.example/webhook", "123", "user-1"],
    });

    const res = await request(makeApp())
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
    await testState.db.current.execute({
      sql: `UPDATE ea_settings
            SET discord_webhook_url_encrypted = ?,
                discord_user_id = ?
            WHERE user_id = ?`,
      args: ["enc:https://discord.example/webhook", "123", "user-1"],
    });

    const res = await request(makeApp())
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
    const missing = await request(makeApp())
      .post("/api/ea/settings/discord-reminder-test")
      .set("Cookie", ["ea_session=cookie-session"]);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("Discord webhook not configured");

    await testState.db.current.execute({
      sql: "UPDATE ea_settings SET discord_webhook_url_encrypted = ? WHERE user_id = ?",
      args: ["enc:https://discord.example/webhook", "user-1"],
    });
    discordReminders.sendDiscordWebhook.mockResolvedValueOnce({
      ok: false,
      status: 429,
      rateLimited: true,
      retryAfterMs: 2500,
      error: "Discord 429",
    });

    const limited = await request(makeApp())
      .post("/api/ea/settings/discord-reminder-test")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("3");
    expect(limited.body.message).toBe("Discord webhook rate limited");
  });

  it("creates, lists, and deletes reminder rows through authenticated routes", async () => {
    await seedSession();
    const dashboardEvents = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event) => {
      dashboardEvents.push(event);
    });
    const createRes = await request(makeApp())
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

    const listRes = await request(makeApp())
      .get("/api/ea/reminders?sourceType=calendar_event&sourceItemId=event-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(listRes.status).toBe(200);
    expect(listRes.body.reminders).toHaveLength(1);

    const deleteRes = await request(makeApp())
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

  it("rejects non-numeric quick-txn amounts before calling Actual", async () => {
    await seedBearer(["actual:write"]);
    const res = await request(makeApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Authorization", "Bearer scoped-token")
      .send({ account: "Checking", amount: "$12.34", payee: "Coffee" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("amount must be a number");
    expect(createQuickTxn).not.toHaveBeenCalled();
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
    ];

    for (const [method, path] of cases) {
      const agent = request(makeApp());
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
    ];

    for (const [method, path] of cases) {
      const res = await request(makeApp())[method](path)
        .set("Authorization", "Bearer scoped-token");

      expect(res.status).toBe(401);
    }
  });
});
