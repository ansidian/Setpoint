import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import type { InStatement } from "@libsql/client";

interface MetadataFixture {
  accounts?: unknown[];
  payees?: unknown[];
  categories?: unknown[];
  schedules?: unknown[];
  recentTransactions?: unknown[];
}

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getAccounts: vi.fn(),
  getCategories: vi.fn(),
  getPayees: vi.fn(),
  getMetadata: vi.fn(),
  getCalendarBillsRange: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
  invalidateActualMetadataCache: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  hydrateLocalActualCache: vi.fn(),
  openLocalBudgetClient: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = {
  execute: vi.fn<(statement: InStatement) => Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>>(),
  batch: vi.fn<(statements: InStatement[]) => Promise<unknown>>(),
};
// Actual Budget is the provider boundary, local metadata is the filesystem
// boundary, and the database is the durable persistence boundary for this
// service facade. The workflow cases inject those boundaries, then inspect a
// real ephemeral database for reconciliation state.
// test-architecture: allow-boundary-mock -- Actual Budget provider results are injected to exercise partial-success and hard-failure outcomes through the Bills facade.
vi.mock("../actual/actual.ts", () => mockActual);
// test-architecture: allow-boundary-mock -- The local Actual cache is a filesystem/provider boundary; the facade tests supply fresh metadata for invalidation.
vi.mock("../actual/actual-local-metadata.ts", () => mockActualLocal);
vi.mock("./bill-extract.ts", () => ({ trimBillBody: ({ body }: { body: string }) => body.slice(0, 100) }));
// test-architecture: allow-boundary-mock -- The service's default database is replaced by an ephemeral client or controlled provider fixture per behavior case.
vi.mock("../db/connection.ts", () => ({ default: mockDb }));

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
let reconciliationDb: ReturnType<typeof createClient> | null = null;

async function useReconciliationDb() {
  reconciliationDb = createClient({ url: "file::memory:" });
  await reconciliationDb.executeMultiple(`
    CREATE TABLE ea_actual_metadata_mirror (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'needs_sync',
      accounts_json TEXT NOT NULL DEFAULT '[]',
      payees_json TEXT NOT NULL DEFAULT '[]',
      categories_json TEXT NOT NULL DEFAULT '[]',
      schedules_json TEXT NOT NULL DEFAULT '[]',
      recent_transactions_json TEXT NOT NULL DEFAULT '[]',
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ea_bills_mirror_state (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'needs_sync',
      actual_configured INTEGER NOT NULL DEFAULT 0,
      actual_budget_url TEXT,
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      pending_refresh_at TEXT,
      refresh_started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  mockDb.execute.mockImplementation(async (statement) => {
    const result = await reconciliationDb!.execute(statement);
    return result as unknown as { rows: Array<Record<string, unknown>>; rowsAffected?: number };
  });
  return reconciliationDb;
}

async function expectReconciliationState() {
  if (!reconciliationDb) throw new Error("reconciliation database was not initialized");
  const mirror = await reconciliationDb.execute({
    sql: "SELECT status, pending_refresh_at FROM ea_bills_mirror_state WHERE user_id = ?",
    args: ["u1"],
  });
  expect(mirror.rows).toHaveLength(1);
  expect(mirror.rows[0]).toMatchObject({
    status: "needs_sync",
    pending_refresh_at: expect.any(String),
  });
  await vi.waitFor(async () => {
    const projection = await reconciliationDb!.execute({
      sql: "SELECT status, last_error FROM ea_actual_metadata_mirror WHERE user_id = ?",
      args: ["u1"],
    });
    expect(projection.rows).toEqual([expect.objectContaining({ status: "current", last_error: null })]);
  });
}

function metadataProjectionRow(metadata: MetadataFixture = {}) {
  return {
    status: "current",
    accounts_json: JSON.stringify(metadata.accounts || []),
    payees_json: JSON.stringify(metadata.payees || []),
    categories_json: JSON.stringify(metadata.categories || []),
    schedules_json: JSON.stringify(metadata.schedules || []),
    recent_transactions_json: JSON.stringify(metadata.recentTransactions || []),
    last_success_at: "2026-05-06T12:00:00.000Z",
    last_attempt_at: "2026-05-06T12:00:00.000Z",
    last_error: null,
  };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  mockActualLocal.describeLocalActualCache.mockReset();
  mockActualLocal.describeLocalActualCache.mockResolvedValue({
    success: true,
    configured: true,
    hydrated: true,
    budgetId: "Budget-1",
  });
  mockActualLocal.hydrateLocalActualCache.mockReset();
  mockActualLocal.hydrateLocalActualCache.mockResolvedValue({
    success: true,
    hydrated: true,
    budgetId: "Budget-1",
    dbSizeBytes: 1024,
    backupCount: 1,
    backupSizeBytes: 512,
    backupPrune: { removed: 0, kept: 1 },
  });
  mockActualLocal.openLocalBudgetClient.mockReset();
  mockActualLocal.readLocalActualMetadata.mockReset();
  mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight metadata unavailable"));
  mockActual.invalidateActualMetadataCache.mockResolvedValue(undefined);
  mockActual.getPayees.mockResolvedValue([]);
  mockActual.getMetadata.mockResolvedValue({ accounts: [], payees: [], categories: [], schedules: [], recentTransactions: [] });
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
  stopBillsMirrorRefreshWorker();
  await reconciliationDb?.close();
  reconciliationDb = null;
});

const {
  getMetadata,
  sendBill,
  markBillPaid,
  createQuickTxn,
  listAccounts,
  hydrateActualCache,
  resolveBillPaySeed,
  resolveBillPaySample,
  stopBillsMirrorRefreshWorker,
} = await import("./bills-service.ts");

function rowResult(rows: Array<Record<string, unknown>> = []) {
  return { rows };
}

describe("Bill Pay resolver service", () => {
  it("loads a triaged server candidate by email id before resolving without Actual metadata", async () => {
    const metadataReader = vi.fn().mockResolvedValue({
      accounts: [],
      payees: [],
      payeeMap: {},
      categories: [],
      schedules: [],
      recentTransactions: [],
      syncHealth: {
        state: "unavailable",
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: "metadata fixture unavailable",
      },
    });
    const occurrenceReader = vi.fn().mockResolvedValue({
      schedules: [],
      syncHealth: {
        state: "unavailable",
        lastSuccessAt: null,
        lastError: "occurrence fixture unavailable",
      },
    });
    const transactionReader = vi.fn().mockResolvedValue({ transactions: [] });
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [{
          bill_pay_mappings_json: JSON.stringify({
            version: 1,
            profiles: [{
              id: "edison",
              enabled: true,
              identity: { aliases: ["edison"] },
              behaviors: [{
                id: "monthly",
                enabled: true,
                type: "expense",
                intent: { subject: ["bill"] },
                amountStrategy: "model_amount",
                targets: {
                  payee_id: "payee-edison",
                  payee_label: "Southern California Edison",
                  category_id: "cat-utilities",
                  category_label: "Utilities",
                },
              }],
            }],
          }),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          bill_candidate_json: JSON.stringify({
            payee_hint: "Edison",
            amount: 64.2,
            due_date: "2026-05-29",
          }),
          from_name: "Edison",
          from_address: "billing@sce.com",
          subject: "Your Edison bill",
          body_snippet: "Statement ready",
          body_text: "Statement ready",
        }],
      });

    const result = await resolveBillPaySeed(
      "u1",
      {
        emailId: "msg-1",
        candidate: { payee_hint: "Client fallback", amount: 1 },
        source: "triage",
      },
      {
        metadataReader,
        occurrenceReader,
        transactionReader,
        now: new Date("2026-07-17T12:00:00.000Z"),
      },
    );

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "edison",
      behaviorId: "monthly",
    });
    expect(result.bill).toMatchObject({
      payee: "Southern California Edison",
      payee_id: "payee-edison",
      category_id: "cat-utilities",
      amount: 64.2,
      due_date: "2026-05-29",
    });
    // test-architecture: allow-boundary-interaction -- The injected occurrence reader is the database/Actual read boundary; this date range must stay aligned with the resolved bill date.
    expect(occurrenceReader).toHaveBeenCalledWith(
      "u1",
      { start: "2026-05-29", end: "2026-05-29" },
      { dbClient: mockDb },
    );
    // test-architecture: allow-boundary-interaction -- The injected transaction reader is the database/Actual read boundary; these filters prevent reconciliation against unrelated transactions.
    expect(transactionReader).toHaveBeenCalledWith("u1", {
      start: "2026-05-29",
      end: "2026-05-29",
      direction: "all",
      include_transfers: true,
      limit: 100,
    });
  });

  it("resolves a pasted-text mapping sample without requiring an email id", async () => {
    mockDb.execute.mockResolvedValueOnce(rowResult([metadataProjectionRow({
      accounts: [],
      payees: [{ id: "payee-spectrum", name: "Spectrum" }],
      categories: [{ id: "cat-internet", name: "Internet" }],
    })]));

    const result = await resolveBillPaySample("u1", {
      mappings: {
        version: 1,
        profiles: [{
          id: "spectrum",
          enabled: true,
          identity: { aliases: ["spectrum"] },
          behaviors: [{
            id: "internet",
            enabled: true,
            type: "expense",
            intent: { body: ["internet statement"] },
            amountStrategy: "amount_due",
            targets: {
              payee_id: "payee-spectrum",
              payee_label: "Spectrum",
              category_id: "cat-internet",
              category_label: "Internet",
            },
          }],
        }],
      },
      email: {
        from: "billing@spectrum.net",
        subject: "Statement",
        body: "Spectrum internet statement. Amount due: $84.99",
      },
      candidate: { payee_hint: "Spectrum", due_date: "2026-06-01" },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "spectrum",
      behaviorId: "internet",
      amountSource: "amount_due",
    });
    expect(result.bill).toMatchObject({
      payee_id: "payee-spectrum",
      category_id: "cat-internet",
      amount: 84.99,
    });
  });
});

describe("sendBill", () => {
  it("forwards to actual.sendBill and schedules a delayed mirror refresh", async () => {
    await useReconciliationDb();
    mockActual.sendBill.mockResolvedValueOnce({ id: "bill-1" });
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
    });
    const out = await sendBill("u1", { payee: "x", amount: 10, type: "bill" });
    expect(out).toEqual({ id: "bill-1" });
    await expectReconciliationState();
  });
});

describe("lightweight write reconciliation on sync-push failure", () => {
  // A lightweight write applied locally but whose Actual-server push failed
  // throws err.localWriteApplied === true. The local write is durable and
  // re-syncs later, so the metadata mirror + bills mirror must still be
  // invalidated/scheduled, and the call must NOT surface as a hard failure
  // (a 5xx would prompt a duplicate-inducing retry).
  function localWriteSyncError() {
    return Object.assign(new Error("Actual sync push failed"), {
      status: 502,
      code: "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
      localWriteApplied: true,
    });
  }

  afterEach(() => {
    stopBillsMirrorRefreshWorker();
  });

  it("sendBill: schedules a mirror refresh and returns partial success instead of throwing", async () => {
    await useReconciliationDb();
    mockActual.sendBill.mockRejectedValueOnce(localWriteSyncError());
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
    });

    const out = await sendBill("u1", { payee: "x", amount: 10, type: "bill" });

    expect(out).toMatchObject({
      syncPending: true,
      localWriteApplied: true,
      code: "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
    });
    await expectReconciliationState();
  });

  it("markBillPaid: still reconciles and does not surface a hard failure", async () => {
    await useReconciliationDb();
    mockActual.markBillPaid.mockRejectedValueOnce(localWriteSyncError());
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
    });

    const out = await markBillPaid("u1", "sched-1");

    expect(out).toMatchObject({ syncPending: true, localWriteApplied: true });
    await expectReconciliationState();
  });

  it("createQuickTxn: still reconciles and does not surface a hard failure", async () => {
    await useReconciliationDb();
    mockActual.createQuickTxn.mockRejectedValueOnce(localWriteSyncError());
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce({
      accounts: [], payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
    });

    const out = await createQuickTxn("u1", { accountName: "Checking", amount: 5, payee: "p" });

    expect(out).toMatchObject({ syncPending: true, localWriteApplied: true });
    await expectReconciliationState();
  });

  it("re-throws errors without localWriteApplied and skips mirror scheduling", async () => {
    await useReconciliationDb();
    mockActual.sendBill.mockRejectedValueOnce(
      Object.assign(new Error("worker boot failed"), { code: "ACTUAL_WORKER_FAILED" }),
    );

    await expect(sendBill("u1", { payee: "x", amount: 10, type: "bill" }))
      .rejects.toMatchObject({ code: "ACTUAL_WORKER_FAILED" });
    const mirror = await reconciliationDb!.execute({
      sql: "SELECT status, pending_refresh_at FROM ea_bills_mirror_state WHERE user_id = ?",
      args: ["u1"],
    });
    expect(mirror.rows).toEqual([]);
  });
});

describe("hydrateActualCache", () => {
  it("hydrates the local Actual cache and refreshes the bills mirror from that cache", async () => {
    const actualMetadata = {
      accounts: [],
      payees: [{ id: "payee-power", name: "Power Co" }],
      payeeMap: { "payee-power": "Power Co" },
      categories: [],
      schedules: [
        {
          id: "power",
          name: "Power Bill",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-power" },
            { field: "amount", value: -12234 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockDb.execute.mockResolvedValueOnce(rowResult([{ actual_budget_url: "https://actual.example.test" }]));
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await hydrateActualCache("u1", {
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(out).toMatchObject({
      success: true,
      hydrated: true,
      budgetId: "Budget-1",
      billsCount: 1,
      schedulesCount: 1,
      syncHealth: { state: "current", configured: true },
    });
  });
});

describe("listAccounts", () => {
  it("reads from the projected Actual metadata mirror", async () => {
    mockDb.execute.mockResolvedValueOnce(rowResult([
      {
        status: "current",
        accounts_json: JSON.stringify([{ id: "a1" }]),
        payees_json: "[]",
        categories_json: "[]",
        schedules_json: "[]",
        recent_transactions_json: "[]",
        last_success_at: "2026-05-06T12:00:00.000Z",
        last_attempt_at: "2026-05-06T12:00:00.000Z",
        last_error: null,
      },
    ]));
    const out = await listAccounts("u1");
    expect(out).toEqual([{ id: "a1" }]);
  });

  it("does not spawn Actual for empty degraded metadata on render-facing reads", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "degraded",
          accounts_json: "[]",
          payees_json: "[]",
          categories_json: "[]",
          schedules_json: "[]",
          recent_transactions_json: "[]",
          last_success_at: null,
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual worker exited",
        },
      ]));

    await expect(listAccounts("u1")).rejects.toMatchObject({
      status: 503,
      message: /Actual metadata projection is unavailable/,
    });
  });

  it("can explicitly refresh empty metadata projections through the worker after lightweight projection fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "needs_sync",
          accounts_json: "[]",
          payees_json: "[]",
          categories_json: "[]",
          schedules_json: "[]",
          recent_transactions_json: "[]",
          last_success_at: null,
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual worker exited",
        },
      ]))
      .mockResolvedValueOnce(rowResult());
    mockActual.getMetadata.mockResolvedValueOnce({
      accounts: [{ id: "a1", name: "Checking" }],
      payees: [],
      categories: [],
    });

    const out = await getMetadata("u1", { allowRefresh: true });

    expect(out.accounts).toEqual([{ id: "a1", name: "Checking" }]);
  });
});
