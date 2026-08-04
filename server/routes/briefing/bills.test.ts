import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../../test-utils/supertest.ts";
import type { Client } from "@libsql/client";
import { createMigratedDb } from "../../snapshots/snapshot-test-fixtures.ts";
import { seedOwner, seedSession } from "../../test-utils/auth-db.ts";
import {
  createRequireCookieSession,
  createRequireRecentPasswordAuth,
} from "../../middleware/auth.ts";
import { createBillsRouters } from "./bills.ts";

const mockBillsService = {
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
  saveActualConnection: vi.fn(),
  removeActualConnection: vi.fn(),
  hydrateActualCache: vi.fn(),
  getActualCacheStatus: vi.fn(),
};

process.env.EA_USER_ID = "user-1";

let db: Client;

function makeApp() {
  const { router } = createBillsRouters({
    service: mockBillsService as never,
    recentAuth: createRequireRecentPasswordAuth(db),
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", createRequireCookieSession(db), router);
  return app;
}

function makeQuickTxnApp() {
  const { quickTxnRouter } = createBillsRouters({
    service: mockBillsService as never,
    quickTxnAuth: createRequireCookieSession(db),
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // quickTxnRouter carries its own requireCookieSessionOrApiTokenScope("actual:write");
  // with no bearer token it falls back to cookie-session validation (mockDb session mock).
  app.use("/api/briefing", quickTxnRouter);
  return app;
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedDb();
  await seedOwner(db, { userId: "user-1", passwordHash: "hash" });
  const now = Date.now();
  await seedSession(db, "cookie-session", now + 60_000, now, {
    authMethod: "password",
    passwordAuthenticatedAt: now,
  });
});

afterEach(() => db.close());

describe("quick-txn amount validation", () => {
  it("rejects a zero amount with 400 and does not write a transaction", async () => {
    const res = await request(makeQuickTxnApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: 0, payee: "Power" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "amount must be greater than 0" });
  });

  it("rejects a negative amount with 400 and does not write a transaction", async () => {
    const res = await request(makeQuickTxnApp())
      .post("/api/briefing/actual/quick-txn")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ account: "Checking", amount: -25, payee: "Power" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "amount must be greater than 0" });
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
  });

  it("rejects a dangerous-scheme serverURL for /actual/test without calling billsService (SEC-05)", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/actual/test")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ serverURL: "gopher://internal", password: "pw", syncId: "sync-1" });

    expect(res.status).toBe(400);
  });

  it("validates and saves an Actual connection candidate in one provider-owned request", async () => {
    mockBillsService.saveActualConnection.mockResolvedValueOnce({
      success: true,
      budgetCount: 1,
      budgetFound: true,
    });

    const res = await request(makeApp())
      .post("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        serverURL: "https://actual.example.test",
        password: "candidate-password",
        syncId: "candidate-sync",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, budgetCount: 1, budgetFound: true });
  });

  it("requires recent password authentication for Actual connection changes", async () => {
    await db.execute("UPDATE ea_sessions SET password_authenticated_at = 0");

    const res = await request(makeApp())
      .post("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        serverURL: "https://actual.example.test",
        password: "candidate-password",
        syncId: "candidate-sync",
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: "PASSWORD_STEP_UP_REQUIRED",
      message: "Confirm your password to continue",
    });
  });

  it("removes the Actual connection through an effect-specific endpoint", async () => {
    mockBillsService.removeActualConnection.mockResolvedValueOnce({ success: true });
    const res = await request(makeApp())
      .delete("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
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
  });
});

describe("POST /bills/extract rate limiting (REL-08)", () => {
  it("returns 429 on the 21st request and stops calling billsService.extractBill after 20", async () => {
    let extractCount = 0;
    mockBillsService.extractBill.mockImplementation(async () => {
      extractCount += 1;
      return { payee: "Power", amount: 42 };
    });

    const app = makeApp();
    let lastRes;
    for (let i = 0; i < 21; i += 1) {
      lastRes = await request(app)
        .post("/api/briefing/bills/extract")
        .set("Cookie", ["ea_session=cookie-session"])
        .send({ subject: "Power bill", from: "billing@example.test", body: "Statement balance: $42" });
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual({ message: "Too many bill-extract requests, try again later" });
    expect(extractCount).toBe(20);
  });
});
