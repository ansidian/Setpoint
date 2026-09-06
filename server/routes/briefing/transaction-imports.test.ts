import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request, { type Test } from "../../test-utils/supertest.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const mockDb = { execute: vi.fn() };
// test-architecture: allow-boundary-mock -- Redirects cookie authentication to ephemeral database results while the route executes normally; the database singleton cannot otherwise be bound per test.
vi.mock("../../db/connection.ts", () => ({ default: mockDb }));

process.env.EA_USER_ID = "owner-1";

const { requireCookieSession } = await import("../../middleware/auth.ts");
const { createTransactionImportRouter } = await import("./transaction-imports.ts");
const { createFinancialEventStore } = await import("../../financial-events/financial-event-store.ts");
const { createFinancialEventCompletion } = await import("../../financial-events/financial-event-completion.ts");
const sessionHash = `sha256:${crypto.createHash("sha256").update("session-token").digest("hex")}`;

function serviceMock() {
  return {
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

function makeApp(service = serviceMock(), financialCompletion?: ReturnType<typeof createFinancialEventCompletion>) {
  let wakeCount = 0;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, createTransactionImportRouter({
    service: service as never,
    financialStatus: async () => null,
    financialCompletion,
    wake: () => { wakeCount += 1; },
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
  it("queues owner completion in the existing managed workflow and rejects unauthenticated, stale and cross-owner requests", async () => {
    const db = createClient({ url: "file::memory:" });
    try {
      for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "062_financial_events.sql"]) {
        await db.executeMultiple(readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), "utf8"));
      }
      await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-01-01T00:00:00Z'");
      for (const [uid, owner] of [["managed", "owner-1"], ["another-owner", "other"]]) {
        await db.execute({ sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
          from_name, from_address, subject, body_text, email_date, email_date_utc, indexed_at)
          VALUES (?, ?, 'gmail', 'Mail', 'owner@example.test', 'Example Market', 'receipt@example.test', 'Receipt',
            'Total $12.00', '2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z')`, args: [uid!, owner!] });
      }
      const store = createFinancialEventStore(db);
      const { app } = makeApp(serviceMock(), createFinancialEventCompletion({ store }));
      const path = "/api/briefing/financial-events/complete";
      const input = { emailUid: "managed", userId: "other", documentRevision: 1, eventRevision: null,
        entry: { kind: "expense", amount: 12, date: "2026-09-06", payee: "Example Market", accountId: "card" } };
      expect((await request(app).post(path).send(input)).status).toBe(401);
      expect((await authenticated(request(app).post(path)).send({ ...input, emailUid: "another-owner" })).status).toBe(404);
      expect((await authenticated(request(app).post(path)).send({ ...input, entry: { ...input.entry, date: "not-a-date" } })).status).toBe(400);
      const response = await authenticated(request(app).post(path)).send(input);
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ workflow: { state: "pending", reason: "Owner-confirmed entry queued for Actual.",
        completion: { documentRevision: 2, eventRevision: 2, canComplete: false } }, targets: { account: { id: "card" } } });
      expect(await store.getEventForEmail("owner-1", "managed")).toMatchObject({ status: "pending", attemptedAt: null,
        operation: null, ownerCompletion: { entry: { accountId: "card", categoryId: null } } });
      expect(await store.getEventForEmail("other", "another-owner")).toBeNull();
      expect((await authenticated(request(app).post(path)).send(input)).status).toBe(409);
    } finally { db.close(); }
  });

  it("requires briefing authentication and derives the owner server-side", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/briefing/transaction-imports/runs")).status).toBe(401);

    const response = await authenticated(request(app).get("/api/briefing/transaction-imports/runs?limit=8"));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ runs: [{ id: "owner-1:8" }] });
  });

  it("does not expose retired mapping read or write endpoints", async () => {
    const { app } = makeApp();
    expect((await authenticated(request(app)
      .get("/api/briefing/transaction-imports/mappings"))).status).toBe(404);
    expect((await authenticated(request(app)
      .put("/api/briefing/transaction-imports/mappings/amazon")
      .send({ mode: "automatic", actualAccountId: "actual-1", actualCategoryId: "category-1" }))).status).toBe(404);
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
      financialEvent: null,
      items: [{ id: "owner-1:gmail-demo-message" }],
    });
  });
});
