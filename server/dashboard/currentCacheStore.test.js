import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCacheRow, markCacheRowRefreshFailed, loadCacheRows } from "./currentCacheStore.js";

// Standalone store coverage (no service harness): exercises both ea_current_data_cache
// ON CONFLICT bodies against an in-memory libsql DB.
let dbClient;

beforeEach(async () => {
  dbClient = createClient({ url: "file::memory:" });
  await dbClient.executeMultiple(`
    CREATE TABLE ea_current_data_cache (
      user_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json TEXT,
      fetched_at TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'current',
      error_message TEXT,
      refresh_started_at TEXT,
      last_refresh_failed_at TEXT,
      last_refresh_error TEXT,
      refresh_failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, cache_key)
    );
  `);
});

afterEach(() => {
  dbClient?.close();
});

describe("currentCacheStore", () => {
  const now = new Date("2026-06-21T00:00:00.000Z");

  it("markCacheRowRefreshFailed on a cold row returns unavailable with failureCount 1", async () => {
    const result = await markCacheRowRefreshFailed("u", "weather_current", new Error("boom"), {
      dbClient,
      now,
      existingRow: null,
    });
    expect(result.status).toBe("unavailable");
    expect(result.refresh_failure_count).toBe(1);
    expect(result.error_message).toBe("boom");
  });

  it("saveCacheRow clears the failure state on conflict", async () => {
    // Seed a failed row (refresh_failure_count -> 1, last_refresh_failed_at set).
    await markCacheRowRefreshFailed("u", "weather_current", new Error("boom"), {
      dbClient,
      now,
      existingRow: null,
    });
    // A successful save must reset the failure bookkeeping.
    await saveCacheRow("u", "weather_current", { ok: true }, { dbClient, now });
    const rows = await loadCacheRows("u", { dbClient });
    const row = rows.weather_current;
    expect(row.status).toBe("current");
    expect(Number(row.refresh_failure_count)).toBe(0);
    expect(row.last_refresh_failed_at).toBeNull();
    expect(row.last_refresh_error).toBeNull();
  });
});
