import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// Actual metadata and its local filesystem cache are genuine provider/filesystem
// boundaries. Projection persistence executes the real migration below.
// test-architecture: allow-boundary-mock -- Actual metadata provider boundary is injected to return compatible and failed metadata reads.
vi.mock("./actual.ts", () => mockActual);
// test-architecture: allow-boundary-mock -- The local Actual cache is a filesystem/provider boundary; projection tests inject its read result.
vi.mock("./actual-local-metadata.ts", () => mockActualLocal);

const {
  readActualMetadataProjection,
  refreshActualMetadataProjection,
  loadActualMetadataForProjection,
} = await import("./actual-metadata-projection.ts");

const NOW = new Date("2026-06-10T12:00:00.000Z");
const TS = NOW.toISOString();
const projectionMigration = readFileSync(
  new URL("../db/migrations/009_actual_metadata_mirror.sql", import.meta.url),
  "utf8",
);
let db: Client;

beforeEach(async () => {
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  Object.values(mockActualLocal).forEach((fn) => fn.mockReset());
  db = createClient({ url: "file::memory:" });
  await db.executeMultiple(projectionMigration);
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

describe("readActualMetadataProjection", () => {
  it("returns null when no projection row exists", async () => {
    const projection = await readActualMetadataProjection("user-1", { dbClient: db });
    expect(projection).toBeNull();
  });

  it("maps a stored row into normalized metadata with payeeMap and sync health", async () => {
    await db.execute({
      sql: `INSERT INTO ea_actual_metadata_mirror
              (user_id, status, accounts_json, payees_json, categories_json,
               schedules_json, recent_transactions_json, last_success_at,
               last_attempt_at, last_error)
            VALUES (?, 'current', ?, ?, 'null', ?, 'not-json', ?, ?, NULL)`,
      args: [
        "user-1",
        JSON.stringify([{ id: "a1", name: "Checking" }]),
        JSON.stringify([{ id: "p1", name: "Comcast" }]),
        JSON.stringify([{ id: "s1" }]),
        "2026-06-09T00:00:00.000Z",
        "2026-06-10T00:00:00.000Z",
      ],
    });
    const projection = await readActualMetadataProjection("user-1", { dbClient: db });
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

describe("refreshActualMetadataProjection", () => {
  it("upserts supplied metadata as current and returns current sync health", async () => {
    const result = await refreshActualMetadataProjection("user-1", {
      now: NOW,
      metadata: { payees: [{ id: "p1", name: "Comcast" }] },
      dbClient: db,
    });
    expect(result.payeeMap).toEqual({ p1: "Comcast" });
    expect(result.syncHealth).toEqual({
      state: "current",
      lastSuccessAt: TS,
      lastAttemptAt: TS,
      lastError: null,
    });
    const persisted = await readActualMetadataProjection("user-1", { dbClient: db });
    expect(persisted).toMatchObject({
      payeeMap: { p1: "Comcast" },
      syncHealth: { state: "current", lastSuccessAt: TS, lastError: null },
    });
  });

  it("loads cached local metadata when none is supplied", async () => {
    mockActualLocal.readLocalActualMetadata.mockResolvedValue({
      accounts: [{ id: "a1", name: "Checking" }],
      payees: [],
    });
    const result = await refreshActualMetadataProjection("user-1", { now: NOW, dbClient: db });
    expect(result.accounts).toEqual([{ id: "a1", name: "Checking" }]);
  });

  it("falls back to the worker when both cached and fresh local reads fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockActualLocal.readLocalActualMetadata
      .mockRejectedValueOnce(new Error("no cache"))
      .mockRejectedValueOnce(new Error("lightweight failed"));
    mockActual.getMetadata.mockResolvedValue({ payees: [{ id: "p9", name: "PG&E" }] });
    const result = await refreshActualMetadataProjection("user-1", { now: NOW, dbClient: db });
    // Worker payee surviving in the result proves the worker path won the fallback.
    expect(result.payeeMap).toEqual({ p9: "PG&E" });
  });

  it("throws instead of touching the worker when allowWorkerFallback is false", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight failed"));
    await expect(loadActualMetadataForProjection("user-1", { allowWorkerFallback: false }))
      .rejects.toThrow("lightweight failed");
  });

  it("records a degraded marker and rethrows when metadata cannot be loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("no cache"));
    mockActual.getMetadata.mockRejectedValue(new Error("worker down"));
    await expect(refreshActualMetadataProjection("user-1", { now: NOW, dbClient: db }))
      .rejects.toThrow("worker down");

    // The same migrated database surfaces the row written by the failed refresh.
    const projection = await readActualMetadataProjection("user-1", { dbClient: db });
    expect(projection!.syncHealth.state).toBe("degraded");
    expect(projection!.syncHealth.lastAttemptAt).toBe(TS);
    expect(projection!.syncHealth.lastError).toBe("worker down");
  });
});
