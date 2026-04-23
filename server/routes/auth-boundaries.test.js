import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import request from "supertest";

const mockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};

vi.mock("../db/connection.js", () => ({ default: mockDb }));
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
  pin: vi.fn(),
  unpin: vi.fn(),
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
vi.mock("../db/scenarios/index.js", () => ({
  listScenarios: vi.fn(() => []),
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
vi.mock("../briefing/claude.js", () => ({
  listModels: vi.fn(async () => []),
}));
vi.mock("../briefing/scheduler.js", () => ({
  initScheduler: vi.fn(),
}));
vi.mock("../embeddings/index.js", () => ({
  isEmbeddingAvailable: vi.fn(() => false),
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

process.env.EA_USER_ID = "user-1";

const { createQuickTxn } = await import("../briefing/bills-service.js");
const briefingRoutes = (await import("./briefing/index.js")).default;
const liveRoutes = (await import("./live.js")).default;
const accountsRoutes = (await import("./accounts.js")).default;
const notesRoutes = (await import("./notes.js")).default;
const bearerHash = crypto.createHash("sha256").update("scoped-token").digest("hex");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/live", liveRoutes);
  app.use("/api/ea", accountsRoutes);
  app.use("/api/notes", notesRoutes);
  return app;
}

function setSessionRow(expiresAt = Date.now() + 60_000) {
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_sessions")) {
      return args[0] === "cookie-session"
        ? { rows: [{ expires_at: expiresAt }] }
        : { rows: [] };
    }
    if (sql.includes("FROM ea_api_tokens")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM ea_settings")) {
      return { rows: [{ user_id: "user-1" }] };
    }
    if (sql.includes("SELECT COUNT(*) as count FROM ea_embeddings")) {
      return { rows: [{ count: 0 }] };
    }
    if (sql.includes("SELECT * FROM ea_notes")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function setBearerRow(scopes = ["actual:write"]) {
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_api_tokens")) {
      return args[0] === bearerHash
        ? { rows: [{ id: 1, scopes: JSON.stringify(scopes), expires_at: null }] }
        : { rows: [] };
    }
    if (sql.startsWith("UPDATE ea_api_tokens SET last_used_at")) {
      return { rows: [] };
    }
    if (sql.includes("FROM ea_sessions")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM ea_settings")) {
      return { rows: [{ user_id: "user-1" }] };
    }
    if (sql.includes("SELECT COUNT(*) as count FROM ea_embeddings")) {
      return { rows: [{ count: 0 }] };
    }
    if (sql.includes("SELECT * FROM ea_notes")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth boundaries", () => {
  it("blocks bearer auth on live route", async () => {
    setBearerRow();
    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on briefing latest route", async () => {
    setBearerRow();
    const res = await request(makeApp())
      .get("/api/briefing/latest")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on settings route", async () => {
    setBearerRow();
    const res = await request(makeApp())
      .get("/api/ea/settings")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("blocks bearer auth on notes route", async () => {
    setBearerRow();
    const res = await request(makeApp())
      .get("/api/notes")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });

  it("allows scoped bearer auth on quick-txn", async () => {
    setBearerRow(["actual:write"]);
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
    setSessionRow();
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

  it("keeps normal cookie session access on protected routes", async () => {
    setSessionRow();
    const res = await request(makeApp())
      .get("/api/briefing/latest")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ briefing: { id: "latest" } });
  });

  it("rejects bearer auth on non-quick-txn bills endpoints", async () => {
    setBearerRow(["actual:write"]);
    const res = await request(makeApp())
      .get("/api/briefing/actual/metadata")
      .set("Authorization", "Bearer scoped-token");

    expect(res.status).toBe(401);
  });
});
