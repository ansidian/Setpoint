import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InStatement } from "@libsql/client";

const mockActual = {
  syncActualMetadata: vi.fn(),
  testConnection: vi.fn(),
  invalidateActualMetadataCache: vi.fn(),
  hydrateActualCache: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  openLocalBudgetClient: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = {
  execute: vi.fn<(statement: InStatement) => Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>>(),
  batch: vi.fn<(statements: InStatement[]) => Promise<unknown>>(),
};
// Actual Budget is the provider boundary, local metadata is the filesystem
// boundary, and the database is the durable persistence boundary for this
// service facade.
// test-architecture: allow-boundary-mock -- Actual Budget provider results are injected so cache hydration can refresh the mirror without a live server.
vi.mock("../actual/actual.ts", () => mockActual);
// test-architecture: allow-boundary-mock -- The local Actual cache is a filesystem/provider boundary; the facade tests supply fresh metadata for invalidation.
vi.mock("../actual/actual-local-metadata.ts", () => mockActualLocal);
// test-architecture: allow-boundary-mock -- The service's default database is replaced by an ephemeral client or controlled provider fixture per behavior case.
vi.mock("../db/connection.ts", () => ({ default: mockDb }));

beforeEach(() => {
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  mockActualLocal.describeLocalActualCache.mockReset();
  mockActualLocal.describeLocalActualCache.mockResolvedValue({
    success: true,
    configured: true,
    hydrated: true,
    budgetId: "Budget-1",
  });
  mockActual.hydrateActualCache.mockReset();
  mockActual.hydrateActualCache.mockResolvedValue({
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
  mockActual.syncActualMetadata.mockResolvedValue({ accounts: [], payees: [], categories: [], schedules: [], recentTransactions: [] });
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  stopBillsMirrorRefreshWorker();
});

const {
  hydrateActualCache,
  stopBillsMirrorRefreshWorker,
} = await import("./bills-service.ts");

function rowResult(rows: Array<Record<string, unknown>> = []) {
  return { rows };
}


describe("hydrateActualCache", () => {
  it("hydrates the worker budget and refreshes the bills mirror from that cache", async () => {
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
