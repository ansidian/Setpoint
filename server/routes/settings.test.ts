import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { seedOwner, seedSession } from "../test-utils/auth-db.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

const schedulerBoundary = vi.hoisted(() => ({
  initScheduler: vi.fn().mockResolvedValue(undefined),
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real settings, validation, model catalog, triage, and credential modules execute together.
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

// test-architecture: allow-boundary-mock -- scheduler startup is a process lifecycle boundary; route persistence and validation still use the real modules.
vi.mock("../scheduler.ts", () => schedulerBoundary);

process.env.EA_USER_ID = "user-1";
process.env.EA_ENCRYPTION_KEY = "11".repeat(32);

const settingsRoutes = (await import("./settings.ts")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/ea", settingsRoutes);
  return app;
}

function authCookie() {
  return ["ea_session=cookie-session"];
}

async function getSettingsRow() {
  const result = await currentDb().execute({
    sql: "SELECT * FROM ea_settings WHERE user_id = ?",
    args: ["user-1"],
  });
  return result.rows[0]!;
}

async function markSessionRecentlyPasswordAuthenticated() {
  const now = Date.now();
  await currentDb().execute({
    sql: "UPDATE ea_sessions SET authenticated_at = ?, password_authenticated_at = ?, auth_method = 'password'",
    args: [now, now],
  });
}

beforeEach(async () => {
  testState.db.current = await createMigratedDb();
  await seedOwner(currentDb(), { passwordHash: "test-password-hash" });
  await seedSession(currentDb());
  await currentDb().execute({
    sql: "ALTER TABLE ea_settings ADD COLUMN future_secret_encrypted TEXT DEFAULT NULL",
    args: [],
  });
  await currentDb().execute({
    sql: "ALTER TABLE ea_settings ADD COLUMN future_api_token TEXT DEFAULT NULL",
    args: [],
  });
  await currentDb().execute({
    sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
    args: ["user-1"],
  });
  schedulerBoundary.initScheduler.mockClear().mockResolvedValue(undefined);
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
  vi.clearAllMocks();
});

describe("settings write-boundary validation", () => {
  it("rejects malformed schedules and leaves the stored row untouched", async () => {
    const before = (await getSettingsRow()).schedules_json;
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ schedules_json: [{ label: "Morning", time: "25:99", enabled: true }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid schedules_json entry: time must be HH:MM (24h)");
    expect((await getSettingsRow()).schedules_json).toBe(before);
  });

  it("stores valid schedules canonically and returns a successful mutation", async () => {
    const schedules = [{ label: "Morning Briefing", time: "08:00", enabled: true, tz: "America/Los_Angeles" }];
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ schedules_json: schedules });

    expect(res.status).toBe(200);
    expect(JSON.parse(String((await getSettingsRow()).schedules_json))).toEqual(schedules);
  });
});

describe("GET /settings todoist_needs_reauth", () => {
  it("includes todoist_needs_reauth: false by default", async () => {
    const res = await request(makeApp()).get("/api/ea/settings");

    expect(res.status).toBe(200);
    expect(res.body.todoist_needs_reauth).toBe(false);
  });

  it("includes todoist_needs_reauth: true when the Todoist grant was revoked", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp()).get("/api/ea/settings");

    expect(res.status).toBe(200);
    expect(res.body.todoist_needs_reauth).toBe(true);
  });
});

describe("Alfred model settings", () => {
  it("returns the normalized default selection from the real model catalog", async () => {
    const res = await request(makeApp()).get("/api/ea/settings");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      alfred_provider: "anthropic",
      alfred_model: expect.any(String),
    });
  });

  it("persists a valid provider/model pair together", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ alfred_provider: "openai", alfred_model: "gpt-5.6-sol" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({
      alfred_provider: "openai",
      alfred_model: "gpt-5.6-sol",
    });
  });

  it("normalizes an invalid provider/model pair to the selected provider default", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ alfred_provider: "openai", alfred_model: "not-a-model" });

    expect(res.status).toBe(200);
    expect(await getSettingsRow()).toMatchObject({
      alfred_provider: "openai",
      alfred_model: "gpt-5.6-sol",
    });
  });

  it("exposes Alfred-specific provider discovery", async () => {
    const res = await request(makeApp()).get("/api/ea/alfred-models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai" }),
    ]));
  });
});

describe("email triage read-arrivals setting", () => {
  it("returns false by default and persists a boolean update", async () => {
    const initial = await request(makeApp()).get("/api/ea/settings");

    expect(initial.status).toBe(200);
    expect(initial.body.email_triage_classify_read_arrivals).toBe(false);

    const update = await request(makeApp())
      .put("/api/ea/settings")
      .send({ email_triage_classify_read_arrivals: true });

    expect(update.status).toBe(200);
    expect((await getSettingsRow()).email_triage_classify_read_arrivals).toBe(1);

    const refreshed = await request(makeApp()).get("/api/ea/settings");
    expect(refreshed.body.email_triage_classify_read_arrivals).toBe(true);
  });

  it("rejects non-boolean values without changing the setting", async () => {
    const response = await request(makeApp())
      .put("/api/ea/settings")
      .send({ email_triage_classify_read_arrivals: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("email_triage_classify_read_arrivals must be a boolean");
    expect((await getSettingsRow()).email_triage_classify_read_arrivals).toBe(0);
  });
});

describe("PUT /settings rejects direct Todoist credential writes", () => {
  it("requires the provider-specific Save & verify endpoint for replacements", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ todoist_api_token: "a-fresh-valid-token" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Todoist Save & verify/i);
    expect(await getSettingsRow()).toMatchObject({
      todoist_needs_reauth: 1,
      todoist_connection_mode: null,
    });
  });

  it("requires the provider-specific disconnect endpoint for removal", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ todoist_api_token: "" });

    expect(res.status).toBe(400);
    expect(await getSettingsRow()).toMatchObject({
      todoist_needs_reauth: 1,
      todoist_connection_mode: null,
    });
  });
});

describe("settings error messages do not leak internals (P3-54)", () => {
  it("returns a fixed important-senders failure string, not the raw DB error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const realExecute = currentDb().execute.bind(currentDb());
    currentDb().execute = ((statement: InStatement) => {
      if (typeof statement !== "string" && statement.sql.includes("important_senders_json")) {
        return Promise.reject(new Error("SQLITE_ERROR: no such column secret_internal_detail"));
      }
      return realExecute(statement);
    }) as Client["execute"];

    const res = await request(makeApp()).get("/api/ea/important-senders");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Failed to fetch important senders");
    expect(JSON.stringify(res.body)).not.toContain("secret_internal_detail");
    consoleError.mockRestore();
  });
});

describe("GET /settings response allowlist (SEC-06)", () => {
  it("never leaks secret-shaped columns, including ones added after this test was written", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_settings SET future_secret_encrypted = ?, future_api_token = ?, weather_location = ?, todoist_oauth_scope = ? WHERE user_id = ?",
      args: [
        "super-secret-value",
        "future-token-value",
        "El Monte, CA",
        "MARKER-todoist-oauth-scope-should-never-leak",
        "user-1",
      ],
    });

    const res = await request(makeApp()).get("/api/ea/settings");
    expect(res.status).toBe(200);
    const bodyJson = JSON.stringify(res.body);
    const secretShaped = /(_encrypted$)|password|secret|(^|_)token/i;
    const leakedKeys = Object.keys(res.body).filter(
      (key) => secretShaped.test(key) && !key.endsWith("_configured"),
    );

    expect(leakedKeys).toEqual([]);
    expect(bodyJson).not.toContain("super-secret-value");
    expect(bodyJson).not.toContain("future-token-value");
    expect(bodyJson).not.toContain("MARKER-todoist-oauth-scope-should-never-leak");
    expect(res.body.email_lookback_hours).toBe(16);
    expect(res.body.weather_lat).toBe(34.0686);
    expect(res.body.weather_location).toBe("El Monte, CA");
    expect(res.body.actual_budget_url).toBeNull();
    expect(res.body.schedules).toEqual([
      { time: "08:00", tz: "America/Los_Angeles", enabled: true, label: "Morning" },
      { time: "20:00", tz: "America/Los_Angeles", enabled: true, label: "Evening" },
    ]);
    expect(res.body.email_interests).toEqual([]);
    expect(res.body.actual_budget_configured).toBe(false);
    expect(res.body.todoist_configured).toBe(false);
    expect(res.body.todoist_oauth_configured).toBe(false);
    expect(res.body.discord_webhook_configured).toBe(false);
  });
});

describe("settings PUT scalar field validation (P3-55)", () => {
  it("rejects a dangerous-scheme actual_budget_url and does not persist (SEC-05)", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ actual_budget_url: "file:///x" });

    expect(res.status).toBe(400);
    expect((await getSettingsRow()).actual_budget_url).toBeNull();
  });

  it("routes even valid Actual settings through the provider-specific endpoint", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ actual_budget_url: "http://localhost:5006" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Actual Budget Save & verify/i);
    expect((await getSettingsRow()).actual_budget_url).toBeNull();
  });

  it("rejects a non-Discord discord_webhook_url and does not encrypt/persist (SEC-05)", async () => {
    await markSessionRecentlyPasswordAuthenticated();
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", authCookie())
      .send({ discord_webhook_url: "https://evil.com/hook" });

    expect(res.status).toBe(400);
    expect((await getSettingsRow()).discord_webhook_url_encrypted).toBeNull();
  });

  it("requires recent password authentication before replacing a Discord webhook", async () => {
    const stale = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", authCookie())
      .send({ discord_webhook_url: "https://discord.com/api/webhooks/123/private-token" });

    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("PASSWORD_STEP_UP_REQUIRED");
    expect((await getSettingsRow()).discord_webhook_url_encrypted).toBeNull();

    await markSessionRecentlyPasswordAuthenticated();
    const recent = await request(makeApp())
      .put("/api/ea/settings")
      .set("Cookie", authCookie())
      .send({ discord_webhook_url: "https://discord.com/api/webhooks/123/private-token" });

    expect(recent.status).toBe(200);
    const encrypted = String((await getSettingsRow()).discord_webhook_url_encrypted);
    expect(encrypted).toMatch(/^gcm:v2:/);
    expect(encrypted).not.toContain("private-token");
  });

  it("accepts unrelated valid scalar settings and persists them", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({
        email_lookback_hours: 24,
        weather_lat: 40.7128,
        weather_lng: -74.006,
      });

    expect(res.status).toBe(200);
    const row = await getSettingsRow();
    expect(row.email_lookback_hours).toBe(24);
    expect(row.weather_lat).toBe(40.7128);
    expect(row.weather_lng).toBe(-74.006);
    expect(row.actual_budget_url).toBeNull();
    expect(row.actual_budget_sync_id).toBeNull();
  });
});
