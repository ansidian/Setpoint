import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { recordAlfredUsage } from "./alfred-usage.ts";

describe("recordAlfredUsage", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_alfred_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(async () => {
    await db.close?.();
  });

  it("inserts a usage row with token counts from Anthropic usage shape", async () => {
    await recordAlfredUsage("user-1", {
      dbClient: db,
      eventType: "alfred_run_turn",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 2048,
      },
      metadata: { iteration: 0 },
      createdAt: new Date("2026-06-12T18:00:00.000Z"),
    });

    const result = await db.execute("SELECT * FROM ea_alfred_usage");
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.user_id).toBe("user-1");
    expect(row.event_type).toBe("alfred_run_turn");
    expect(Number(row.input_tokens)).toBe(1200);
    expect(Number(row.cached_input_tokens)).toBe(800);
    expect(Number(row.cache_creation_input_tokens)).toBe(2048);
    expect(Number(row.output_tokens)).toBe(340);
    expect(JSON.parse(String(row.metadata_json))).toEqual({ iteration: 0 });
  });

});
