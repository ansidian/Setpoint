import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockActual = {
  syncActualMetadata: vi.fn(),
};
const mockActualLocal = {
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
} = await import("./actual-metadata-projection.ts");

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
