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
}));

vi.mock("../../db/connection.js", () => ({ default: mockDb }));
vi.mock("../../briefing/bills-service.js", () => mockBillsService);

process.env.EA_USER_ID = "user-1";

const billsRouter = (await import("./bills.js")).default;
const cookieSessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, billsRouter);
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

describe("Bill Pay routes", () => {
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
});
