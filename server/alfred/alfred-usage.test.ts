import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { recordAlfredUsage } from "./alfred-usage.ts";
import { getAlfredUsageStats } from "./alfred-usage-stats.ts";
import { consumeOpenAiStream } from "./openai-stream.ts";

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
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({ iteration: 0, accounting: { version: 1, pricingVersion: "standard-text-2026-09-10" } });
  });

  it("includes Anthropic cache reads and writes in analytics input and cost", async () => {
    const now = new Date("2026-09-10T18:00:00Z");
    await recordAlfredUsage("user-1", {
      dbClient: db, eventType: "alfred_run_turn", model: "claude-sonnet-4-6",
      usage: { input_tokens: 1200, cache_read_input_tokens: 800, cache_creation_input_tokens: 2048, output_tokens: 340 },
      metadata: { provider: "anthropic", conversation_id: "one" }, createdAt: now,
    });
    const stats = await getAlfredUsageStats("user-1", { dbClient: db, now });
    expect(stats.estimatedCostUsd).toBeCloseTo(0.01662, 8);
    expect(stats.inputTokens).toBe(4048);
    expect(stats.cacheHitRate).toBeCloseTo(800 / 4048, 4);
    expect(stats.estimatedSavingsUsd).toBeCloseTo(0.000624, 8);
  });

  it("keeps OpenAI input inclusive through stream, recording, and analytics", async () => {
    const now = new Date("2026-09-10T18:00:00Z");
    const turn = await consumeOpenAiStream((async function* () {
      yield `data: ${JSON.stringify({ type: "response.completed", response: {
        model: "gpt-5.6-sol", status: "completed", service_tier: "default", output: [],
        usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 } },
      } })}\n\n`;
    })());
    await recordAlfredUsage("user-1", {
      dbClient: db, eventType: "alfred_run_turn", model: turn.model!, usage: turn.usage,
      metadata: { provider: "openai", conversation_id: "one" }, createdAt: now,
    });
    const stats = await getAlfredUsageStats("user-1", { dbClient: db, now });
    expect(stats.inputTokens).toBe(1000);
    expect(stats.cacheCreationInputTokens).toBe(300);
    expect(stats.cacheHitRate).toBe(0.6);
    expect(stats.estimatedCostUsd).toBeCloseTo(0.00414, 8);
    expect(stats.estimatedSavingsUsd).toBeCloseTo(0.00186, 8);
  });

  it("prices one-hour writes and preserves negative net savings", async () => {
    const now = new Date("2026-09-10T18:00:00Z");
    await recordAlfredUsage("user-1", {
      dbClient: db, eventType: "alfred_run_turn", model: "claude-haiku-4-5",
      usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } },
      metadata: {}, createdAt: now,
    });
    const stats = await getAlfredUsageStats("user-1", { dbClient: db, now });
    expect(stats.estimatedCostUsd).toBeCloseTo(0.000625, 8);
    expect(stats.estimatedSavingsUsd).toBeCloseTo(-0.000225, 8);
  });

  it.each([
    { model: "claude-future", usage: { input_tokens: 100, output_tokens: 10 } },
    { model: "gpt-5.6-sol", usage: {} },
    { model: "gpt-5.6-sol", usage: { input_tokens: 100, output_tokens: 10, service_tier: "fast" } },
  ])("reports unpriced calls instead of free usage for $model", async ({ model, usage }) => {
    const now = new Date("2026-09-10T18:00:00Z");
    await recordAlfredUsage("user-1", { dbClient: db, eventType: "alfred_run_turn", model, usage, metadata: {}, createdAt: now });
    const stats = await getAlfredUsageStats("user-1", { dbClient: db, now });
    expect(stats).toMatchObject({ turns: 1, unpricedCalls: 1, estimatedCostUsd: null, estimatedSavingsUsd: null });
    expect(stats.byModel[model]).toMatchObject({ unpricedCalls: 1, estimatedCostUsd: null });
    expect(stats.comparisonWindows.monthToDate.estimatedCostUsd).toBeNull();
  });

  it("combines historical provider-shaped rows without losing cache input", async () => {
    const now = new Date("2026-09-10T18:00:00Z");
    for (const [model, input] of [["claude-haiku-4-5", 100], ["gpt-5.6-sol", 1000]] as const) {
      await recordAlfredUsage("user-1", {
        dbClient: db, eventType: "alfred_run_turn", model,
        usage: { input_tokens: input, output_tokens: 100, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 },
        metadata: {}, createdAt: now,
      });
    }
    // Model the old storage format, before accounting snapshots existed.
    await db.execute("UPDATE ea_alfred_usage SET metadata_json = '{}'");
    const stats = await getAlfredUsageStats("user-1", { dbClient: db, now });
    expect(stats.inputTokens).toBe(2000);
    expect(stats.cacheHitRate).toBe(0.6);
    expect(stats.estimatedCostUsd).toBeCloseTo(0.005175, 8);
    expect(stats.unpricedCalls).toBe(0);
    expect(stats.byProvider.openai).toMatchObject({ turns: 1, inputTokens: 1000, estimatedCostUsd: 0.00414 });
    expect(stats.byProvider.anthropic).toMatchObject({ turns: 1, inputTokens: 1000, estimatedCostUsd: 0.001035 });
    expect(stats.byProvider.anthropic.comparisonWindows.monthToDate.turns).toBe(1);
  });
});
