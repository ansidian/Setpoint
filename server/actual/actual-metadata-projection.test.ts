import { describe, it, expect, vi, beforeEach } from "vitest";

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getMetadata: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  hydrateLocalActualCache: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = { execute: vi.fn(), batch: vi.fn() };
vi.mock("./actual.ts", () => mockActual);
vi.mock("./actual-local-metadata.ts", () => mockActualLocal);
vi.mock("../db/connection.ts", () => ({ default: mockDb }));

const {
  readActualMetadataProjection,
  refreshActualMetadataProjection,
  loadActualMetadataForProjection,
  upsertMetadataProjectionQuery,
} = await import("./actual-metadata-projection.ts");

const NOW = new Date("2026-06-10T12:00:00.000Z");
const TS = NOW.toISOString();

beforeEach(() => {
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  Object.values(mockActualLocal).forEach((fn) => fn.mockReset());
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe("readActualMetadataProjection", () => {
  it("returns null when no projection row exists", async () => {
    const projection = await readActualMetadataProjection("user-1");
    expect(projection).toBeNull();
    const [{ sql, args }] = mockDb.execute.mock.calls[0]!;
    expect(sql).toMatch(/ea_actual_metadata_mirror/);
    expect(args).toEqual(["user-1"]);
  });

  it("maps a stored row into normalized metadata with payeeMap and sync health", async () => {
    mockDb.execute.mockResolvedValue({
      rows: [{
        status: "current",
        accounts_json: JSON.stringify([{ id: "a1", name: "Checking" }]),
        payees_json: JSON.stringify([{ id: "p1", name: "Comcast" }]),
        categories_json: null,
        schedules_json: JSON.stringify([{ id: "s1" }]),
        recent_transactions_json: "not-json",
        last_success_at: "2026-06-09T00:00:00.000Z",
        last_attempt_at: "2026-06-10T00:00:00.000Z",
        last_error: null,
      }],
    });
    const projection = await readActualMetadataProjection("user-1");
    expect(projection!.accounts).toEqual([{ id: "a1", name: "Checking" }]);
    expect(projection!.payeeMap).toEqual({ p1: "Comcast" });
    expect(projection!.categories).toEqual([]);
    expect(projection!.recentTransactions).toEqual([]);
    expect(projection!.schedules).toEqual([{ id: "s1" }]);
    expect(projection!.syncHealth).toEqual({
      state: "current",
      lastSuccessAt: "2026-06-09T00:00:00.000Z",
      lastAttemptAt: "2026-06-10T00:00:00.000Z",
      lastError: null,
    });
  });
});

describe("upsertMetadataProjectionQuery", () => {
  it("builds a current-status upsert carrying the normalized payees and timestamps", () => {
    const { sql, args } = upsertMetadataProjectionQuery(
      "user-1",
      { payees: [{ id: "p1", name: "Comcast" }] },
      TS,
    );
    // The table + 'current' marker are the behavioral signal of this builder.
    expect(sql).toMatch(/INSERT INTO ea_actual_metadata_mirror/);
    expect(sql).toMatch(/'current'/);
    expect(args[0]).toBe("user-1");
    expect(args[2]).toBe(JSON.stringify([{ id: "p1", name: "Comcast" }]));
    expect(args).toContain(TS);
  });
});

describe("refreshActualMetadataProjection", () => {
  it("upserts supplied metadata as current and returns current sync health", async () => {
    const result = await refreshActualMetadataProjection("user-1", {
      now: NOW,
      metadata: { payees: [{ id: "p1", name: "Comcast" }] },
    });
    expect(mockActualLocal.readLocalActualMetadata).not.toHaveBeenCalled();
    expect(result.payeeMap).toEqual({ p1: "Comcast" });
    expect(result.syncHealth).toEqual({
      state: "current",
      lastSuccessAt: TS,
      lastAttemptAt: TS,
      lastError: null,
    });
  });

  it("loads cached local metadata when none is supplied", async () => {
    mockActualLocal.readLocalActualMetadata.mockResolvedValue({
      accounts: [{ id: "a1", name: "Checking" }],
      payees: [],
    });
    const result = await refreshActualMetadataProjection("user-1", { now: NOW });
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("user-1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(result.accounts).toEqual([{ id: "a1", name: "Checking" }]);
  });

  it("falls back to the worker when both cached and fresh local reads fail", async () => {
    mockActualLocal.readLocalActualMetadata
      .mockRejectedValueOnce(new Error("no cache"))
      .mockRejectedValueOnce(new Error("lightweight failed"));
    mockActual.getMetadata.mockResolvedValue({ payees: [{ id: "p9", name: "PG&E" }] });
    const result = await refreshActualMetadataProjection("user-1", { now: NOW });
    // Worker payee surviving in the result proves the worker path won the fallback.
    expect(result.payeeMap).toEqual({ p9: "PG&E" });
    // The worker is an outbound boundary; assert it was reached with refresh flags.
    expect(mockActual.getMetadata).toHaveBeenCalledWith("user-1", {
      forceWorker: true,
      forceRefresh: true,
    });
  });

  it("throws instead of touching the worker when allowWorkerFallback is false", async () => {
    mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight failed"));
    await expect(loadActualMetadataForProjection("user-1", { allowWorkerFallback: false }))
      .rejects.toThrow("lightweight failed");
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("records a degraded marker and rethrows when metadata cannot be loaded", async () => {
    mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("no cache"));
    mockActual.getMetadata.mockRejectedValue(new Error("worker down"));
    await expect(refreshActualMetadataProjection("user-1", { now: NOW }))
      .rejects.toThrow("worker down");

    // The failed refresh persisted the worker error to the projection.
    const degradedWrite = mockDb.execute.mock.calls.at(-1)![0];
    expect(degradedWrite.args).toContain("user-1");
    expect(degradedWrite.args).toContain("worker down");

    // The persisted degraded row surfaces through the public read API.
    mockDb.execute.mockResolvedValue({
      rows: [{
        status: "degraded",
        accounts_json: null,
        payees_json: null,
        categories_json: null,
        schedules_json: null,
        recent_transactions_json: null,
        last_success_at: null,
        last_attempt_at: TS,
        last_error: "worker down",
      }],
    });
    const projection = await readActualMetadataProjection("user-1");
    expect(projection!.syncHealth.state).toBe("degraded");
    expect(projection!.syncHealth.lastError).toBe("worker down");
  });
});
