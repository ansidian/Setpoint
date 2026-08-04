import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "../../test-utils/supertest.ts";

const mockDb = { execute: vi.fn() };

// test-architecture: allow-boundary-mock -- Redirects the production cookie-session database singleton for this HTTP test; the route dependencies themselves are injected and observed through responses.
vi.mock("../../db/connection.ts", () => ({ default: mockDb }));

process.env.EA_USER_ID = "user-1";

const { requireCookieSession } = await import("../../middleware/auth.ts");
const { createEmailIndexRouter } = await import("./email-index.ts");
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
  let wakeCount = 0;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, createEmailIndexRouter({
    getHealth: async (userId) => ({ accounts: [{ account_id: `gmail-${userId}` }] }) as never,
    queueBackfill: async (userId, options) => ({
      queued: true,
      accounts: [{ account_id: `gmail-${userId}-${options?.targetDays}` }],
    }) as never,
    wake: () => { wakeCount += 1; },
  }));
  return { app, wakeCount: () => wakeCount };
}

function setSessionRow() {
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_sessions")) {
      return args[0] === cookieSessionHash
        ? { rows: [{
            expires_at: Date.now() + 60_000,
            authenticated_at: 0,
            password_authenticated_at: 0,
            security_generation: 1,
            auth_method: "legacy",
          }] }
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
      const res = await request(makeApp().app)
        .get("/api/briefing/email-index/health")
        .set("Cookie", ["ea_session=cookie-session"]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accounts: [{ account_id: "gmail-user-1" }] });
    } finally {
      restoreNodeEnv();
    }
  });

  it("queues a manual backfill trigger without running the backfill synchronously", async () => {
    const harness = makeApp();
    const res = await request(harness.app)
      .post("/api/briefing/email-index/backfill")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ targetDays: 90 });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true, accounts: [{ account_id: "gmail-user-1-90" }] });
    expect(harness.wakeCount()).toBe(1);
  });
});
