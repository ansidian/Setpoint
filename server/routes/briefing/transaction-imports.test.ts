import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request, { type Test } from "../../test-utils/supertest.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";

const mockDb = { execute: vi.fn() };
// test-architecture: allow-boundary-mock -- Redirects cookie authentication to ephemeral database results while the route executes normally; the database singleton cannot otherwise be bound per test.
vi.mock("../../db/connection.ts", () => ({ default: mockDb }));

process.env.EA_USER_ID = "owner-1";

const { requireCookieSession } = await import("../../middleware/auth.ts");
const { createTransactionImportRouter } = await import("./transaction-imports.ts");
const { createFinancialEventStore } = await import("../../financial-events/financial-event-store.ts");
const { createFinancialEventCompletion } = await import("../../financial-events/financial-event-completion.ts");
const { readFinancialReviewChanges } = await import("../../financial-events/financial-event-review.ts");
const sessionHash = `sha256:${crypto.createHash("sha256").update("session-token").digest("hex")}`;

function serviceMock() {
  return {
    listItemsForEmail: async (userId: string, emailUid: string) => [{ id: `${userId}:${emailUid}` }],
    commitItems: async (userId: string, runId: string, items: unknown[]) => ({
      accepted: items.length,
      owner: userId,
      runId,
    }),
    retryItem: async (userId: string, itemId: string) => ({ accepted: true, owner: userId, itemId }),
    dismissItem: async (userId: string, itemId: string) => ({ dismissed: true, owner: userId, itemId }),
  };
}

function makeApp(service = serviceMock(), financialCompletion?: ReturnType<typeof createFinancialEventCompletion>, financialDb?: Client) {
  let wakeCount = 0;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, createTransactionImportRouter({
    service: service as never,
    financialStatus: async () => null,
    financialCompletion,
    financialDismissal: financialCompletion?.dismiss,
    financialReviewChanges: financialDb ? (userId, options) => readFinancialReviewChanges(userId, { ...options, dbClient: financialDb }) : undefined,
    wake: () => { wakeCount += 1; },
  }));
  return { app, service, wakeCount: () => wakeCount };
}

function authenticated(requestBuilder: Test): Test {
  return requestBuilder.set("Cookie", ["ea_session=session-token"]);
}

async function managedDb(): Promise<Client> {
  const db = createClient({ url: "file::memory:" });
  for (const file of ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql", "054_email_sender_authentication.sql", "062_financial_events.sql", "068_financial_candidate_dismissal.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql", "055_generic_financial_email_imports.sql", "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql", "059_generic_financial_email_transfer_automation.sql", "063_financial_activity.sql", "064_financial_corrections.sql"]) {
    await db.executeMultiple(readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2026-01-01T00:00:00Z'");
  for (const [uid, owner] of [["managed", "owner-1"], ["another-owner", "other"]]) {
    await db.execute({ sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email,
      from_name, from_address, subject, body_text, email_date, email_date_utc, indexed_at)
      VALUES (?, ?, 'gmail', 'Mail', 'owner@example.test', 'Example Market', 'receipt@example.test', 'Receipt',
        'Total $12.00', '2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z')`, args: [uid!, owner!] });
  }
  return db;
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
  it("dismisses only the authenticated owner's current candidate", async () => {
    const db = await managedDb();
    try {
      await db.execute(`UPDATE ea_financial_documents SET candidate_json = '{"type":"expense","amount":12}'`);
      const store = createFinancialEventStore(db);
      const { app } = makeApp(serviceMock(), createFinancialEventCompletion({ store }));
      const path = "/api/briefing/financial-events/dismiss";
      const input = { emailUid: "managed", documentRevision: 1, eventRevision: null, userId: "other" };
      expect((await request(app).post(path).send(input)).status).toBe(401);
      expect((await authenticated(request(app).post(path)).send({ ...input, emailUid: "another-owner" })).status).toBe(404);
      expect((await authenticated(request(app).post(path)).send({ ...input, documentRevision: 20 })).status).toBe(409);
      const response = await authenticated(request(app).post(path)).send(input);
      expect(response.status).toBe(200);
      expect(response.body.workflow).toMatchObject({ dismissed: true, completion: { canComplete: false } });
      expect((await store.getDocumentForEmail("other", "another-owner"))?.dismissedAt).toBeNull();
    } finally { db.close(); }
  });

  it("queues owner completion in the existing managed workflow and rejects unauthenticated, stale and cross-owner requests", async () => {
    const db = await managedDb();
    try {
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

  it("serves owner-scoped notification changes without changing their durable state", async () => {
    const db = await managedDb();
    try {
      await db.execute({ sql: `UPDATE ea_financial_documents SET status = 'retry', candidate_json = ?,
        last_error = 'Waiting for evidence that distinguishes similar purchases.', updated_at = 1000`,
      args: [JSON.stringify({ type: "expense", event_kind: "purchase", amount: 12, amount_kind: "transaction_amount", currency: "USD" })] });
      const { app } = makeApp(serviceMock(), undefined, db);
      const changesPath = "/api/briefing/financial-events/review-changes";
      expect((await request(app).get(changesPath)).status).toBe(401);
      const changes = await authenticated(request(app).get(`${changesPath}?afterAt=0&afterId=&userId=other`));
      expect(changes.status).toBe(200);
      expect(changes.body).toEqual({ items: [{ key: expect.stringMatching(/^financial-review:/), emailUid: "managed" }],
        cursor: { updatedAt: 1000, id: expect.stringMatching(/^document:/) }, hasMore: false });
      const second = await authenticated(request(app).get(changesPath).query({ afterAt: changes.body.cursor.updatedAt, afterId: changes.body.cursor.id }));
      expect(second.body).toEqual({ items: [], cursor: changes.body.cursor, hasMore: false });
      expect(await createFinancialEventStore(db).getDocumentForEmail("owner-1", "managed")).toMatchObject({ status: "retry", attempts: 0, eventId: null });
    } finally { db.close(); }
  });

  it("rejects malformed and incomplete financial review cursors", async () => {
    const { app } = makeApp();
    for (const query of ["afterAt=1", "afterId=event:x", "afterAt=-1&afterId=x", "afterAt=1.5&afterId=x", "afterAt=0&afterId=a&afterId=b", `afterAt=0&afterId=${"a".repeat(601)}`]) {
      expect((await authenticated(request(app).get(`/api/briefing/financial-events/review-changes?${query}`))).status).toBe(400);
    }
  });

  it("requires briefing authentication and derives the owner server-side", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/briefing/transaction-imports/runs")).status).toBe(401);

    const response = await authenticated(request(app).get("/api/briefing/transaction-imports/email-status?emailUid=message"));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [{ id: "owner-1:message" }] });
  });

  it("does not expose retired mapping and history endpoints", async () => {
    const { app } = makeApp();
    for (const path of ['/transaction-imports/runs', '/transaction-imports/runs/saved', '/financial-events/review']) {
      expect((await authenticated(request(app).get(`/api/briefing${path}`))).status).toBe(404);
    }
    expect((await authenticated(request(app).post('/api/briefing/transaction-imports/runs')).send({})).status).toBe(404);
    expect((await authenticated(request(app)
      .get("/api/briefing/transaction-imports/mappings"))).status).toBe(404);
    expect((await authenticated(request(app)
      .put("/api/briefing/transaction-imports/mappings/amazon")
      .send({ mode: "automatic", actualAccountId: "actual-1", actualCategoryId: "category-1" }))).status).toBe(404);
  });

  it("returns 202 for commit and retry admission and wakes the worker", async () => {
    const { app, wakeCount } = makeApp();
    const commit = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/runs/run-1/commit")
      .send({ items: [{ itemId: "item-1" }] }));
    const retry = await authenticated(request(app)
      .post("/api/briefing/transaction-imports/items/item-1/retry"));

    expect([commit.status, retry.status]).toEqual([202, 202]);
    expect(commit.body).toMatchObject({ accepted: 1, owner: "owner-1", runId: "run-1" });
    expect(retry.body).toMatchObject({ accepted: true, owner: "owner-1", itemId: "item-1" });
    expect(wakeCount()).toBe(2);
  });

  it("shapes owner-scoped status and dismiss responses", async () => {
    const service = serviceMock();
    const { app } = makeApp(service);
    expect((await authenticated(request(app).get("/api/briefing/transaction-imports/runs/not-owned"))).status).toBe(404);

    const dismissed = await authenticated(request(app).post("/api/briefing/transaction-imports/items/item-1/dismiss"));
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toEqual({ dismissed: true, owner: "owner-1", itemId: "item-1" });
  });

  it("lists email status through owner-scoped read paths", async () => {
    const { app } = makeApp();
    const status = await authenticated(request(app)
      .get("/api/briefing/transaction-imports/email-status?emailUid=gmail-demo-message"));

    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      emailUid: "gmail-demo-message",
      financialEvent: null,
      items: [{ id: "owner-1:gmail-demo-message" }],
    });
  });
});
