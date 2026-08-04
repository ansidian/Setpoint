import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request, { type Test } from "../../test-utils/supertest.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };
// test-architecture: allow-boundary-mock -- Redirects cookie authentication to ephemeral database results while the route executes normally; the database singleton cannot otherwise be bound per test.
vi.mock("../../db/connection.ts", () => ({ default: mockDb }));

process.env.EA_USER_ID = "owner-1";

const { requireCookieSession } = await import("../../middleware/auth.ts");
const { createTransactionImportRouter } = await import("./transaction-imports.ts");
const sessionHash = `sha256:${crypto.createHash("sha256").update("session-token").digest("hex")}`;

function serviceMock() {
  return {
    listMappings: async (userId: string) => [{ source: "amazon", owner: userId }],
    upsertMapping: async (userId: string, input: Record<string, unknown>) => ({ ...input, owner: userId }),
    startHistoricalScan: async (userId: string, input: { gmailAccountIds: string[] }) => ({
      runId: `${userId}:${input.gmailAccountIds.join(",")}`,
      created: true,
    }),
    listRuns: async (userId: string, limit: number) => [{ id: `${userId}:${limit}` }],
    listItemsForEmail: async (userId: string, emailUid: string) => [{ id: `${userId}:${emailUid}` }],
    getRun: async (_userId: string, runId: string) => ({ id: runId, items: [] }),
    commitItems: async (userId: string, runId: string, items: unknown[]) => ({
      accepted: items.length,
      owner: userId,
      runId,
    }),
    retryItem: async (userId: string, itemId: string) => ({ accepted: true, owner: userId, itemId }),
    dismissItem: async (userId: string, itemId: string) => ({ dismissed: true, owner: userId, itemId }),
  };
}

function makeApp(service = serviceMock()) {
  let wakeCount = 0;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, createTransactionImportRouter({
    service: service as never,
    wake: () => { wakeCount += 1; },
    loadAccounts: async () => [{ id: "actual-1" }] as never,
    loadCategories: async () => [{ categories: [{ id: "category-1" }] }] as never,
  }));
  return { app, service, wakeCount: () => wakeCount };
}

function authenticated(requestBuilder: Test): Test {
  return requestBuilder.set("Cookie", ["ea_session=session-token"]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (String(sql).includes("FROM ea_sessions") && args[0] === sessionHash) {
      return { rows: [{ expires_at: Date.now() + 60_000, authenticated_at: 1, password_authenticated_at: 1, security_generation: 1, auth_method: "legacy" }] };
    }
    return { rows: [] };
  });
});

describe("transaction import routes", () => {
  it("requires briefing authentication and derives the owner server-side", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/briefing/transaction-imports/mappings")).status).toBe(401);

    const response = await authenticated(request(app).get("/api/briefing/transaction-imports/mappings"));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ source: "amazon", owner: "owner-1" }]);
  });

  it("validates mapping allowlists and live Actual IDs", async () => {
    const { app } = makeApp();
    expect((await authenticated(request(app)
      .put("/api/briefing/transaction-imports/mappings/venmo")
      .send({ mode: "automatic", actualAccountId: "actual-1" }))).status).toBe(400);
    expect((await authenticated(request(app)
      .put("/api/briefing/transaction-imports/mappings/amazon")
      .send({ mode: "automatic", actualAccountId: "missing" }))).status).toBe(400);

    const response = await authenticated(request(app)
      .put("/api/briefing/transaction-imports/mappings/amazon")
      .send({ mode: "automatic", actualAccountId: "actual-1", actualCategoryId: "category-1" }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ owner: "owner-1", source: "amazon", mode: "automatic" });
  });

  it("returns 202 for scan, commit, and retry admission and wakes the worker", async () => {
    const { app, wakeCount } = makeApp();
    const scan = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/runs")
      .send({ gmailAccountIds: ["gmail-1"], sources: ["amazon"], startDate: "2026-01-01", endDate: "2026-02-01" }));
    const commit = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/runs/run-1/commit")
      .send({ items: [{ itemId: "item-1" }] }));
    const retry = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/items/item-1/retry"));

    expect([scan.status, commit.status, retry.status]).toEqual([202, 202, 202]);
    expect(scan.body).toMatchObject({ runId: "owner-1:gmail-1", created: true });
    expect(commit.body).toMatchObject({ accepted: 1, owner: "owner-1", runId: "run-1" });
    expect(retry.body).toMatchObject({ accepted: true, owner: "owner-1", itemId: "item-1" });
    expect(wakeCount()).toBe(3);
  });

  it("shapes owner-scoped status and dismiss responses", async () => {
    const service = serviceMock();
    service.getRun = async () => null as never;
    const { app } = makeApp(service);
    expect((await authenticated(request(app).get("/api/briefing/transaction-imports/runs/not-owned"))).status).toBe(404);

    const dismissed = await authenticated(request(app).post("/api/briefing/transaction-imports/items/item-1/dismiss"));
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toEqual({ dismissed: true, owner: "owner-1", itemId: "item-1" });
  });

  it("lists recent runs and email status through owner-scoped read paths", async () => {
    const { app } = makeApp();
    const runs = await authenticated(request(app).get("/api/briefing/transaction-imports/runs?limit=8"));
    const status = await authenticated(request(app)
      .get("/api/briefing/transaction-imports/email-status?emailUid=gmail-demo-message"));

    expect(runs.status).toBe(200);
    expect(runs.body).toEqual({ runs: [{ id: "owner-1:8" }] });
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      emailUid: "gmail-demo-message",
      items: [{ id: "owner-1:gmail-demo-message" }],
    });
  });
});
