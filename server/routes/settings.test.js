import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import express from "express";
import request from "supertest";

import { geocodeLocation } from "../platform/weather.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("../platform/encryption.js", () => ({
  encrypt: vi.fn((value) => `enc:${value}`),
  decrypt: vi.fn((value) => value),
}));
vi.mock("../platform/weather.js", () => ({
  geocodeLocation: vi.fn(async () => []),
}));
vi.mock("../scheduler.js", () => ({
  initScheduler: vi.fn(async () => {}),
}));
vi.mock("../bills/bill-extractors/catalog.js", () => ({
  billExtractAvailability: vi.fn(() => []),
  isAllowedBillExtractModel: vi.fn(() => true),
  DEFAULT_BILL_EXTRACT_PROVIDER: "anthropic",
  DEFAULT_BILL_EXTRACT_MODEL: "haiku",
}));

process.env.EA_USER_ID = "user-1";

const settingsRoutes = (await import("./settings.js")).default;
const { initScheduler } = await import("../scheduler.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ea", settingsRoutes);
  return app;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      schedules_json TEXT,
      email_interests_json TEXT,
      important_senders_json TEXT DEFAULT '[]',
      email_triage_mode TEXT DEFAULT 'auto',
      email_lookback_hours INTEGER DEFAULT 16,
      weather_lat REAL DEFAULT 34.0686,
      weather_lng REAL DEFAULT -118.0276,
      weather_location TEXT,
      actual_budget_url TEXT,
      actual_budget_sync_id TEXT,
      todoist_needs_reauth INTEGER NOT NULL DEFAULT 0,
      todoist_api_token_encrypted TEXT,
      todoist_oauth_refresh_token_encrypted TEXT,
      todoist_oauth_access_token_expires_at INTEGER,
      todoist_oauth_scope TEXT,
      todoist_oauth_token_type TEXT,
      discord_webhook_url_encrypted TEXT,
      future_secret_encrypted TEXT,
      future_api_token TEXT
    );
    CREATE TABLE ea_completed_tasks (
      user_id TEXT,
      task_id TEXT
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
    args: ["user-1"],
  });
  return db;
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

describe("settings write-boundary validation", () => {
  it("rejects malformed schedules and leaves the stored row untouched", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ schedules_json: [{ label: "Morning", time: "25:99", enabled: true }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid schedules_json entry: time must be HH:MM (24h)");
    expect((await getSettingsRow()).schedules_json).toBeNull();
    expect(initScheduler).not.toHaveBeenCalled();
  });

  it("stores valid schedules canonically and hot-reloads the scheduler", async () => {
    const schedules = [{ label: "Morning Briefing", time: "08:00", enabled: true, tz: "America/Los_Angeles" }];
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ schedules_json: schedules });

    expect(res.status).toBe(200);
    expect(JSON.parse((await getSettingsRow()).schedules_json)).toEqual(schedules);
    expect(initScheduler).toHaveBeenCalledTimes(1);
  });

  it("rejects non-string email interests", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ email_interests_json: ["ai", 42] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email_interests_json entry: must be a non-empty string");
    expect((await getSettingsRow()).email_interests_json).toBeNull();
  });

  it("accepts email interests sent as a JSON string and stores the canonical form", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ email_interests_json: '["ai infrastructure"]' });

    expect(res.status).toBe(200);
    expect((await getSettingsRow()).email_interests_json).toBe('["ai infrastructure"]');
  });

  it("rejects important senders without a usable address", async () => {
    const res = await request(makeApp())
      .put("/api/ea/important-senders")
      .send({ senders: [{ name: "boss" }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid senders entry: address must be an email address");
    expect((await getSettingsRow()).important_senders_json).toBe("[]");
  });

  it("stores valid important senders", async () => {
    const senders = [{ address: "boss@company.com", name: "boss", source: "manual" }];
    const res = await request(makeApp())
      .put("/api/ea/important-senders")
      .send({ senders });

    expect(res.status).toBe(200);
    expect(JSON.parse((await getSettingsRow()).important_senders_json)).toEqual(senders);
  });
});

describe("GET /settings todoist_needs_reauth", () => {
  it("includes todoist_needs_reauth: false by default", async () => {
    const res = await request(makeApp()).get("/api/ea/settings");

    expect(res.status).toBe(200);
    expect(res.body.todoist_needs_reauth).toBe(false);
  });

  it("includes todoist_needs_reauth: true when the Todoist grant was revoked", async () => {
    await testState.db.current.execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp()).get("/api/ea/settings");

    expect(res.status).toBe(200);
    expect(res.body.todoist_needs_reauth).toBe(true);
  });
});

describe("PUT /settings todoist_api_token clears todoist_needs_reauth (REL-01)", () => {
  it("clears todoist_needs_reauth when a non-empty token is saved (manual reconnect)", async () => {
    await testState.db.current.execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ todoist_api_token: "a-fresh-valid-token" });

    expect(res.status).toBe(200);
    expect((await getSettingsRow()).todoist_needs_reauth).toBe(0);
  });

  it("does not clear todoist_needs_reauth when disconnecting (empty token)", async () => {
    await testState.db.current.execute({
      sql: "UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = ?",
      args: ["user-1"],
    });

    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ todoist_api_token: "" });

    expect(res.status).toBe(200);
    expect((await getSettingsRow()).todoist_needs_reauth).toBe(1);
  });
});

describe("settings error messages do not leak internals (P3-54)", () => {
  it("returns a fixed geocode failure string, not the raw error message", async () => {
    geocodeLocation.mockRejectedValueOnce(new Error("ENOTFOUND api.pirateweather.net secret-key=abc123"));

    const res = await request(makeApp()).get("/api/ea/geocode?q=Berlin");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Failed to geocode location");
    expect(JSON.stringify(res.body)).not.toContain("secret-key");
  });

  it("returns a fixed important-senders failure string, not the raw DB error", async () => {
    const realExecute = testState.db.current.execute.bind(testState.db.current);
    vi.spyOn(testState.db.current, "execute").mockImplementation((arg) => {
      if (typeof arg?.sql === "string" && arg.sql.includes("important_senders_json")) {
        return Promise.reject(new Error("SQLITE_ERROR: no such column secret_internal_detail"));
      }
      return realExecute(arg);
    });

    const res = await request(makeApp()).get("/api/ea/important-senders");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Failed to fetch important senders");
    expect(JSON.stringify(res.body)).not.toContain("secret_internal_detail");
  });
});

describe("GET /settings response allowlist (SEC-06)", () => {
  it("never leaks secret-shaped columns, including ones added after this test was written", async () => {
    await testState.db.current.execute({
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

    // No response key looks secret-shaped, except the intentional `*_configured`
    // booleans (which are derived presence flags, not secrets themselves).
    const secretShaped = /(_encrypted$)|password|secret|(^|_)token/i;
    const leakedKeys = Object.keys(res.body).filter(
      (key) => secretShaped.test(key) && !key.endsWith("_configured")
    );
    expect(leakedKeys).toEqual([]);

    // Decoy secret values must not appear anywhere in the serialized response.
    expect(bodyJson).not.toContain("super-secret-value");
    expect(bodyJson).not.toContain("future-token-value");

    // todoist_oauth_scope is a real, currently-excluded ea_settings column whose
    // name doesn't match the secret-shaped regex above (no _encrypted/password/
    // secret/token substring), so a future accidental re-addition to
    // SETTINGS_PUBLIC_FIELDS would slip past the key-shape check. Assert its
    // value directly, the same way the decoy columns are checked.
    expect(bodyJson).not.toContain("MARKER-todoist-oauth-scope-should-never-leak");

    // Known public fields must still come through.
    expect(res.body.email_lookback_hours).toBe(16);
    expect(res.body.weather_lat).toBe(34.0686);
    expect(res.body.weather_location).toBe("El Monte, CA");
    expect(res.body.actual_budget_url).toBeNull();
    expect(res.body.schedules).toEqual([
      { label: "Morning Briefing", time: "08:00", enabled: false },
      { label: "Evening Briefing", time: "20:00", enabled: false },
    ]);
    expect(res.body.email_interests).toEqual([]);
    expect(res.body.actual_budget_configured).toBe(false);
    expect(res.body.todoist_configured).toBe(false);
    expect(res.body.todoist_oauth_configured).toBe(false);
    expect(res.body.discord_webhook_configured).toBe(false);
  });
});

describe("settings PUT scalar field validation (P3-55)", () => {
  it("rejects an out-of-range weather coordinate and does not persist", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ weather_lat: 200 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("weather_lat must be a number between -90 and 90");
    // Default left untouched.
    expect((await getSettingsRow()).weather_lat).toBe(34.0686);
  });

  it("rejects a negative email_lookback_hours and does not persist", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ email_lookback_hours: -5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("email_lookback_hours must be an integer between 1 and 168");
    expect((await getSettingsRow()).email_lookback_hours).toBe(16);
  });

  it("rejects a non-string actual_budget_url and does not persist", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ actual_budget_url: { evil: true } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("actual_budget_url must be a string");
    expect((await getSettingsRow()).actual_budget_url).toBeNull();
  });

  it("rejects a dangerous-scheme actual_budget_url and does not persist (SEC-05)", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ actual_budget_url: "file:///x" });

    expect(res.status).toBe(400);
    expect((await getSettingsRow()).actual_budget_url).toBeNull();
  });

  it("accepts a loopback actual_budget_url (self-hosted Actual server, SEC-05)", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ actual_budget_url: "http://localhost:5006" });

    expect(res.status).toBe(200);
    expect((await getSettingsRow()).actual_budget_url).toBe("http://localhost:5006");
  });

  it("rejects a non-Discord discord_webhook_url and does not encrypt/persist (SEC-05)", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({ discord_webhook_url: "https://evil.com/hook" });

    expect(res.status).toBe(400);
    expect((await getSettingsRow()).discord_webhook_url_encrypted).toBeNull();
  });

  it("accepts valid scalar settings and persists them", async () => {
    const res = await request(makeApp())
      .put("/api/ea/settings")
      .send({
        email_lookback_hours: 24,
        weather_lat: 40.7128,
        weather_lng: -74.006,
        actual_budget_url: "https://actual.example.com",
        actual_budget_sync_id: "sync-123",
      });

    expect(res.status).toBe(200);
    const row = await getSettingsRow();
    expect(row.email_lookback_hours).toBe(24);
    expect(row.weather_lat).toBe(40.7128);
    expect(row.weather_lng).toBe(-74.006);
    expect(row.actual_budget_url).toBe("https://actual.example.com");
    expect(row.actual_budget_sync_id).toBe("sync-123");
  });
});
