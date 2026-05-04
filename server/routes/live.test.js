import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  db: { current: null },
  gmailFetchEmails: vi.fn(),
  icloudFetchEmails: vi.fn(),
  calendarFetch: vi.fn(),
  weatherFetch: vi.fn(),
  actualBills: vi.fn(),
  actualRecentTransactions: vi.fn(),
  actualMetadata: vi.fn(),
  isGmailMessageRead: vi.fn(),
  isIcloudMessageRead: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));
vi.mock("../briefing/encryption.js", () => ({ decrypt: (v) => v }));
vi.mock("../briefing/gmail.js", () => ({
  fetchEmails: (...args) => testState.gmailFetchEmails(...args),
  isMessageRead: (...args) => testState.isGmailMessageRead(...args),
}));
vi.mock("../briefing/icloud.js", () => ({
  fetchEmails: (...args) => testState.icloudFetchEmails(...args),
  isMessageRead: (...args) => testState.isIcloudMessageRead(...args),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: (...args) => testState.calendarFetch(...args),
  getNextWeekRange: () => [0, 0],
  getTomorrowRange: () => [0, 0],
}));
vi.mock("../briefing/weather.js", () => ({
  fetchWeather: (...args) => testState.weatherFetch(...args),
}));
vi.mock("../briefing/actual.js", () => ({
  getUpcomingBills: (...args) => testState.actualBills(...args),
  getRecentTransactions: (...args) => testState.actualRecentTransactions(...args),
  getMetadata: (...args) => testState.actualMetadata(...args),
  isSchedulePaid: () => false,
}));
vi.mock("../briefing/index.js", () => ({
  loadUserConfig: async () => ({
    accounts: [
      {
        id: "gmail-a",
        type: "gmail",
        label: "Work",
        email: "w@example.com",
        credentials_encrypted: "{}",
      },
    ],
    settings: {
      weather_location: "El Monte, CA",
      important_senders_json: JSON.stringify([{ address: "boss@example.com", name: "Boss" }]),
    },
  }),
}));

process.env.EA_USER_ID = "u1";

const { default: router } = await import("./live.js");

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use("/api/live", router);
  return app;
}

function hashSessionToken(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE ea_snoozed_emails (
      user_id TEXT NOT NULL,
      email_id TEXT NOT NULL,
      until_ts INTEGER,
      resurfaced_at INTEGER,
      email_snapshot TEXT,
      status TEXT NOT NULL
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken("cookie-session"), Date.now() + 60_000],
  });
  return db;
}

async function seedEmailState({ snoozed = [], resurfaced = [] } = {}) {
  for (const entry of snoozed) {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, resurfaced_at, email_snapshot, status)
            VALUES (?, ?, ?, NULL, ?, 'snoozed')`,
      args: ["u1", entry.id, entry.untilTs, JSON.stringify(entry.snapshot)],
    });
  }
  for (const entry of resurfaced) {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, resurfaced_at, email_snapshot, status)
            VALUES (?, ?, NULL, ?, ?, 'resurfaced')`,
      args: ["u1", entry.id, entry.resurfacedAt, JSON.stringify(entry.snapshot)],
    });
  }
}

describe("GET /api/live/all", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    testState.gmailFetchEmails.mockReset().mockResolvedValue([]);
    testState.icloudFetchEmails.mockReset().mockResolvedValue([]);
    testState.calendarFetch.mockReset().mockResolvedValue([]);
    testState.weatherFetch.mockReset().mockResolvedValue({ temp: 0, high: 0, low: 0, summary: "", hourly: [] });
    testState.actualBills.mockReset().mockResolvedValue([]);
    testState.actualRecentTransactions.mockReset().mockResolvedValue([]);
    testState.actualMetadata.mockReset().mockResolvedValue({ schedules: [], payeeMap: {}, recentTransactions: [] });
    testState.isGmailMessageRead.mockReset().mockResolvedValue(null);
    testState.isIcloudMessageRead.mockReset().mockResolvedValue(null);
    delete process.env.EA_LIVE_TIMEOUT_WEATHER_MS;
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a cookie session before fetching live data", async () => {
    const res = await request(makeApp()).get("/api/live/all");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
    expect(testState.gmailFetchEmails).not.toHaveBeenCalled();
  });

  it("fetches the active email window without legacy briefing rows", async () => {
    testState.gmailFetchEmails.mockResolvedValueOnce([
      {
        uid: "gmail-live",
        from: "Boss <boss@example.com>",
        subject: "Standup",
        read: false,
      },
    ]);

    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(testState.gmailFetchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-a", email: "w@example.com" }),
      12,
    );
    expect(res.body).toMatchObject({
      briefingGeneratedAt: null,
      briefingReadStatus: {},
      snoozedEntries: [],
      resurfacedEntries: [],
      actualConfigured: false,
      actualBudgetUrl: null,
    });
    expect(res.body.emails).toHaveLength(1);
    expect(res.body.emails[0]).toMatchObject({
      uid: "gmail-live",
      subject: "Standup",
      isImportantSender: true,
    });
    expect(res.body.weather.location).toBe("El Monte, CA");
  });

  it("returns active snoozed and resurfaced email state", async () => {
    testState.isGmailMessageRead.mockResolvedValueOnce(true);
    await seedEmailState({
      snoozed: [{
        id: "gmail-snoozed",
        untilTs: Date.now() + 60_000,
        snapshot: { uid: "gmail-snoozed", subject: "Later" },
      }],
      resurfaced: [{
        id: "gmail-resurfaced",
        resurfacedAt: Date.now() - 10_000,
        snapshot: {
          uid: "gmail-resurfaced",
          account_id: "gmail-a",
          subject: "Awake again",
          read: false,
        },
      }],
    });

    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("pinnedIds");
    expect(res.body).not.toHaveProperty("pinnedSnapshots");
    expect(res.body.snoozedEntries).toEqual([
      expect.objectContaining({
        uid: "gmail-snoozed",
        snapshot: expect.objectContaining({ subject: "Later" }),
      }),
    ]);
    expect(res.body.resurfacedEntries).toEqual([
      expect.objectContaining({
        uid: "gmail-resurfaced",
        read: true,
        snapshot: expect.objectContaining({ subject: "Awake again" }),
      }),
    ]);
    expect(testState.isGmailMessageRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-a" }),
      "gmail-resurfaced",
    );
  });

  it("returns degraded fallback data when a live provider times out", async () => {
    process.env.EA_LIVE_TIMEOUT_WEATHER_MS = "20";
    testState.weatherFetch.mockImplementationOnce(() => new Promise(() => {}));

    const startedAt = Date.now();
    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(res.status).toBe(200);
    expect(res.body.weather).toMatchObject({
      temp: 0,
      high: 0,
      low: 0,
      summary: "Weather unavailable",
      hourly: [],
      location: "El Monte, CA",
    });
    expect(res.body.degraded).toEqual({
      any: true,
      sources: [
        expect.objectContaining({
          source: "weather",
          reason: "timeout",
          timeoutMs: 20,
        }),
      ],
    });
  });
});
