import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import type { InStatement } from "@libsql/client";
import { readFileSync } from "node:fs";

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
// test-architecture: allow-boundary-mock -- The service's default database is replaced by an ephemeral client or controlled provider fixture per behavior case.
vi.mock("../db/connection.ts", () => ({ default: mockDb }));

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
let reconciliationDb: ReturnType<typeof createClient> | null = null;

async function useReconciliationDb() {
  reconciliationDb = createClient({ url: "file::memory:" });
  for (const migration of ["001_ea_tables.sql", "009_actual_metadata_mirror.sql"]) {
    await reconciliationDb.executeMultiple(readFileSync(new URL(`../db/migrations/${migration}`, import.meta.url), "utf8"));
  }
  mockDb.execute.mockImplementation(async (statement) => {
    const result = await reconciliationDb!.execute(statement);
    return result as unknown as { rows: Array<Record<string, unknown>>; rowsAffected?: number };
  });
  mockDb.batch.mockImplementation((statements) => reconciliationDb!.batch(statements));
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
  invalidateActualAfterTransactionImport,
  sendBill,
  markBillPaid,
  createQuickTxn,
  listAccounts,
  hydrateActualCache,
  stopBillsMirrorRefreshWorker,
} = await import("./bills-service.ts");

function rowResult(rows: Array<Record<string, unknown>> = []) {
  return { rows };
}


describe("settled Actual invalidation", () => {
  it("publishes the already synchronized budget into metadata and paid bill projections immediately", async () => {
    const database = await useReconciliationDb();
    await database.execute("INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test')");
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const metadata = {
      accounts: [{ id: "checking", name: "Checking" }],
      payees: [{ id: "power", name: "Fictional Power" }], categories: [],
      schedules: [{ id: "bill", name: "Fictional Power", next_date: date, type: "bill",
        conditions: [{ field: "payee", value: "power" }, { field: "amount", value: -5_000 }] }],
      recentTransactions: [{ id: "paid", scheduleId: "bill", payeeId: "power", amount: 50, date }],
    };
    mockActualLocal.readLocalActualMetadata.mockImplementation(async (_userId, options) => {
      if (options.refresh !== false) throw new Error("The verified write must not request another provider sync");
      return metadata;
    });
    await invalidateActualAfterTransactionImport("u1");
    expect((await database.execute("SELECT status, pending_refresh_at FROM ea_bills_mirror_state")).rows)
      .toEqual([expect.objectContaining({ status: "current", pending_refresh_at: null })]);
    expect((await database.execute("SELECT schedule_id, paid, amount FROM ea_bill_occurrence_mirror")).rows)
      .toEqual([expect.objectContaining({ schedule_id: "bill", paid: 1, amount: 50 })]);
    const projection = (await database.execute("SELECT status, recent_transactions_json FROM ea_actual_metadata_mirror")).rows[0]!;
    expect(projection.status).toBe("current");
    expect(JSON.parse(String(projection.recent_transactions_json))).toEqual(metadata.recentTransactions);
  });

  it("retains a durable mirror retry when metadata invalidation fails", async () => {
    const database = await useReconciliationDb();
    mockActual.invalidateActualMetadataCache.mockRejectedValue(new Error('Actual cache unavailable'));
    await expect(invalidateActualAfterTransactionImport('u1')).rejects.toThrow('Actual cache unavailable');
    const { rows } = await database.execute("SELECT status, pending_refresh_at FROM ea_bills_mirror_state WHERE user_id='u1'");
    expect(rows).toEqual([expect.objectContaining({ status:'needs_sync', pending_refresh_at:expect.any(String) })]);
  });

  it("retains reconciliation when publishing the local verified budget fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const database = await useReconciliationDb();
    await database.execute("INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test')");
    mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("Local verified budget unavailable"));
    await invalidateActualAfterTransactionImport("u1");
    expect((await database.execute("SELECT status, pending_refresh_at, last_error FROM ea_bills_mirror_state")).rows)
      .toEqual([expect.objectContaining({ status: "needs_sync", pending_refresh_at: expect.any(String),
        last_error: "Local verified budget unavailable" })]);
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
