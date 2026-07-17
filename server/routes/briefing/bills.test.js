import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { requireCookieSession } from "../../middleware/auth.js";

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));
const mockBillsService = vi.hoisted(() => ({
  sendBill: vi.fn(),
  createQuickTxn: vi.fn(),
  extractBill: vi.fn(),
  resolveBillPaySeed: vi.fn(),
  resolveBillPaySample: vi.fn(),
  markBillPaid: vi.fn(),
  getMetadata: vi.fn(),
  listAccounts: vi.fn(),
  listPayees: vi.fn(),
  listCategories: vi.fn(),
  testConnection: vi.fn(),
  hydrateActualCache: vi.fn(),
  getActualCacheStatus: vi.fn(),
}));

vi.mock("../../db/connection.ts", () => ({ default: mockDb }));
vi.mock("../../bills/bills-service.js", () => mockBillsService);

process.env.EA_USER_ID = "user-1";

const billsModule = await import("./bills.js");
const billsRouter = billsModule.default;
const quickTxnRouter = billsModule.quickTxnRouter;
const cookieSessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, billsRouter);
  return app;
}

function makeQuickTxnApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // quickTxnRouter carries its own requireCookieSessionOrApiTokenScope("actual:write");
  // with no bearer token it falls back to cookie-session validation (mockDb session mock).
  app.use("/api/briefing", quickTxnRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_sessions")) {
      return args[0] === cookieSessionHash
        ? { rows: [{ expires_at: Date.now() + 60_000 }] }
        : { rows: [] };
    }
    return { rows: [] };
  });
});

describe("quick-txn amount validation", () => {
  it("rejects a zero amount with 400 and does not write a transaction", async () => {
    const res = await request(makeQuickTxnApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: 0, payee: "Power" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "amount must be greater than 0" });
    expect(mockBillsService.createQuickTxn).not.toHaveBeenCalled();
  });

  it("rejects a negative amount with 400 and does not write a transaction", async () => {
    const res = await request(makeQuickTxnApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: -25, payee: "Power" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "amount must be greater than 0" });
    expect(mockBillsService.createQuickTxn).not.toHaveBeenCalled();
  });
});

describe("Bill Pay routes", () => {
  it("rejects a malformed due_date before writing to Actual (P2-39)", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/actual/send")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ type: "bill", payee: "Power", amount: 42, due_date: "2026-13-40" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/due_date/);
    expect(mockBillsService.sendBill).not.toHaveBeenCalled();
  });

  it("resolves a Bill Pay seed through briefing cookie auth", async () => {
    mockBillsService.resolveBillPaySeed.mockResolvedValueOnce({
      bill: { payee: "Power", amount: 42 },
      mapping: { status: "matched", profileId: "power" },
    });

    const res = await request(makeApp())
      .post("/api/briefing/bills/resolve")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        emailId: "msg-1",
        accountId: "gmail-work",
        subject: "Power bill",
        from: "billing@example.test",
        body: "Statement balance: $42",
        candidate: { payee_hint: "Power", amount: 10 },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bill: { payee: "Power", amount: 42 },
      mapping: { status: "matched", profileId: "power" },
    });
    expect(mockBillsService.resolveBillPaySeed).toHaveBeenCalledWith("user-1", {
      emailId: "msg-1",
      accountId: "gmail-work",
      subject: "Power bill",
      from: "billing@example.test",
      body: "Statement balance: $42",
      snippet: undefined,
      candidate: { payee_hint: "Power", amount: 10 },
      source: "triage",
    });
  });

  it("resolves a pasted Bill Pay sample through briefing cookie auth", async () => {
    mockBillsService.resolveBillPaySample.mockResolvedValueOnce({
      bill: { payee: "Citi", amount: 25 },
      mapping: { status: "matched", profileId: "citi", behaviorId: "minimum" },
    });

    const mappings = {
      version: 1,
      profiles: [{ id: "citi", enabled: true, identity: { domain: ["citi.com"] } }],
    };

    const res = await request(makeApp())
      .post("/api/briefing/bills/resolve-sample")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        mappings,
        email: {
          from: "alerts@citi.com",
          subject: "Payment due",
          body: "Minimum due: $25",
        },
        candidate: { payee: "Citi", amount: 10, due_date: "2026-05-15" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bill: { payee: "Citi", amount: 25 },
      mapping: { status: "matched", profileId: "citi", behaviorId: "minimum" },
    });
    expect(mockBillsService.resolveBillPaySample).toHaveBeenCalledWith("user-1", {
      mappings,
      email: {
        from: "alerts@citi.com",
        subject: "Payment due",
        body: "Minimum due: $25",
      },
      candidate: { payee: "Citi", amount: 10, due_date: "2026-05-15" },
    });
  });

  it("hydrates the Actual cache through briefing cookie auth", async () => {
    mockBillsService.hydrateActualCache.mockResolvedValueOnce({
      success: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });

    const res = await request(makeApp())
      .post("/api/briefing/actual/cache/hydrate")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });
    expect(mockBillsService.hydrateActualCache).toHaveBeenCalledWith("user-1");
  });

  it("rejects a dangerous-scheme serverURL for /actual/test without calling billsService (SEC-05)", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/actual/test")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ serverURL: "gopher://internal", password: "pw", syncId: "sync-1" });

    expect(res.status).toBe(400);
    expect(mockBillsService.testConnection).not.toHaveBeenCalled();
  });

  it("validates the local Actual cache through briefing cookie auth", async () => {
    mockBillsService.getActualCacheStatus.mockResolvedValueOnce({
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });

    const res = await request(makeApp())
      .get("/api/briefing/actual/cache/status")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });
    expect(mockBillsService.getActualCacheStatus).toHaveBeenCalledWith("user-1");
  });
});

describe("POST /bills/extract rate limiting (REL-08)", () => {
  it("returns 429 on the 21st request and stops calling billsService.extractBill after 20", async () => {
    mockBillsService.extractBill.mockResolvedValue({ payee: "Power", amount: 42 });

    const app = makeApp();
    let lastRes;
    for (let i = 0; i < 21; i += 1) {
      lastRes = await request(app)
        .post("/api/briefing/bills/extract")
        .set("Cookie", ["ea_session=cookie-session"])
        .send({ subject: "Power bill", from: "billing@example.test", body: "Statement balance: $42" });
    }

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many bill-extract requests, try again later" });
    expect(mockBillsService.extractBill).toHaveBeenCalledTimes(20);
  });
});
