import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "supertest";

const mockDb = { execute: vi.fn() };

vi.mock("../../db/connection.ts", () => ({ default: mockDb }));
vi.mock("../../email/email-index.ts", () => ({
  getEmailIndexHealth: vi.fn(async () => ({ accounts: [{ account_id: "gmail-work" }] })),
  queueEmailIndexBackfill: vi.fn(async () => ({ queued: true, accounts: [{ account_id: "gmail-work" }] })),
}));
vi.mock("../../email/email-backfill-worker.ts", () => ({
  wakeEmailBackfillWorker: vi.fn(),
}));

process.env.EA_USER_ID = "user-1";

const emailIndexService = await import("../../email/email-index.ts");
const emailBackfillWorker = await import("../../email/email-backfill-worker.ts");
const briefingRoutes = (await import("./index.ts")).default;
const originalNodeEnv = process.env.NODE_ENV;
const cookieSessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function restoreNodeEnv() {
  if (originalNodeEnv == null) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  return app;
}

function setSessionRow() {
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_sessions")) {
      return args[0] === cookieSessionHash
        ? { rows: [{ expires_at: Date.now() + 60_000 }] }
        : { rows: [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  restoreNodeEnv();
  setSessionRow();
});

describe("email index routes", () => {
  it("returns production-available health through briefing cookie auth", async () => {
    process.env.NODE_ENV = "production";

    try {
      const res = await request(makeApp())
        .get("/api/briefing/email-index/health")
        .set("Cookie", ["ea_session=cookie-session"]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accounts: [{ account_id: "gmail-work" }] });
      expect(emailIndexService.getEmailIndexHealth).toHaveBeenCalledWith("user-1");
    } finally {
      restoreNodeEnv();
    }
  });

  it("queues a manual backfill trigger without running the backfill synchronously", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/email-index/backfill")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ targetDays: 90 });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true, accounts: [{ account_id: "gmail-work" }] });
    expect(emailIndexService.queueEmailIndexBackfill).toHaveBeenCalledWith("user-1", {
      targetDays: 90,
    });
    expect(emailBackfillWorker.wakeEmailBackfillWorker).toHaveBeenCalledWith();
  });
});
