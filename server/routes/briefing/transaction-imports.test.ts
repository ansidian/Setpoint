import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request, { type Test } from "../../test-utils/supertest.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../../db/connection.ts", () => ({ default: mockDb }));
vi.mock("../../transaction-imports/transaction-import-service.ts", () => ({ transactionImportService: {} }));
vi.mock("../../transaction-imports/transaction-import-runtime.ts", () => ({ requestTransactionImportDrain: vi.fn() }));
vi.mock("../../bills/bills-service.ts", () => ({ listAccounts: vi.fn(), listCategories: vi.fn() }));

process.env.EA_USER_ID = "owner-1";

const { requireCookieSession } = await import("../../middleware/auth.ts");
const { createTransactionImportRouter } = await import("./transaction-imports.ts");
const sessionHash = `sha256:${crypto.createHash("sha256").update("session-token").digest("hex")}`;

function serviceMock() {
  return {
    listMappings: vi.fn().mockResolvedValue([]),
    upsertMapping: vi.fn(async (_userId, input) => input),
    startHistoricalScan: vi.fn().mockResolvedValue({ runId: "run-1", created: true }),
    listRuns: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    listItemsForEmail: vi.fn().mockResolvedValue([{ id: "item-1" }]),
    getRun: vi.fn().mockResolvedValue({ id: "run-1", items: [] }),
    commitItems: vi.fn().mockResolvedValue({ accepted: 1 }),
    retryItem: vi.fn().mockResolvedValue({ accepted: true }),
    dismissItem: vi.fn().mockResolvedValue({ dismissed: true }),
  };
}

function makeApp(service = serviceMock(), wake = vi.fn()) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, createTransactionImportRouter({
    service: service as never,
    wake,
    loadAccounts: vi.fn().mockResolvedValue([{ id: "actual-1" }]) as never,
    loadCategories: vi.fn().mockResolvedValue([{ categories: [{ id: "category-1" }] }]) as never,
  }));
  return { app, service, wake };
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
    const { app, service } = makeApp();
    expect((await request(app).get("/api/briefing/transaction-imports/mappings")).status).toBe(401);

    const response = await authenticated(request(app).get("/api/briefing/transaction-imports/mappings"));
    expect(response.status).toBe(200);
    expect(service.listMappings).toHaveBeenCalledWith("owner-1");
  });

  it("validates mapping allowlists and live Actual IDs", async () => {
    const { app, service } = makeApp();
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
    expect(service.upsertMapping).toHaveBeenCalledWith("owner-1", expect.objectContaining({ source: "amazon", mode: "automatic" }));
  });

  it("returns 202 for scan, commit, and retry admission and wakes the worker", async () => {
    const { app, service, wake } = makeApp();
    const scan = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/runs")
      .send({ gmailAccountIds: ["gmail-1"], sources: ["amazon"], startDate: "2026-01-01", endDate: "2026-02-01" }));
    const commit = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/runs/run-1/commit")
      .send({ items: [{ itemId: "item-1" }] }));
    const retry = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/items/item-1/retry"));

    expect([scan.status, commit.status, retry.status]).toEqual([202, 202, 202]);
    expect(service.startHistoricalScan).toHaveBeenCalledWith("owner-1", expect.any(Object));
    expect(service.commitItems).toHaveBeenCalledWith("owner-1", "run-1", [{ itemId: "item-1" }]);
    expect(service.retryItem).toHaveBeenCalledWith("owner-1", "item-1");
    expect(wake).toHaveBeenCalledTimes(3);
  });

  it("shapes owner-scoped status and dismiss responses", async () => {
    const service = serviceMock();
    service.getRun.mockResolvedValueOnce(null as never);
    const { app } = makeApp(service);
    expect((await authenticated(request(app).get("/api/briefing/transaction-imports/runs/not-owned"))).status).toBe(404);

    const dismissed = await authenticated(request(app).post("/api/briefing/transaction-imports/items/item-1/dismiss"));
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toEqual({ dismissed: true });
    expect(service.dismissItem).toHaveBeenCalledWith("owner-1", "item-1");
  });

  it("lists recent runs and email status through owner-scoped read paths", async () => {
    const { app, service } = makeApp();
    const runs = await authenticated(request(app).get("/api/briefing/transaction-imports/runs?limit=8"));
    const status = await authenticated(request(app)
      .get("/api/briefing/transaction-imports/email-status?emailUid=gmail-demo-message"));

    expect(runs.status).toBe(200);
    expect(runs.body).toEqual({ runs: [{ id: "run-1" }] });
    expect(service.listRuns).toHaveBeenCalledWith("owner-1", 8);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ emailUid: "gmail-demo-message", items: [{ id: "item-1" }] });
    expect(service.listItemsForEmail).toHaveBeenCalledWith("owner-1", "gmail-demo-message");
  });
});
