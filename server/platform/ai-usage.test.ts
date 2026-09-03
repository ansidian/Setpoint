import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAiUsageEvent, trackedAiProviderCall, withAiUsageContext, type AiUsageEvent } from "./ai-usage.ts";
import { getEmailAiUsageStats } from "./ai-usage-stats.ts";
import { getTriageCacheStats } from "../triage/triage-cache-stats.ts";
import { estimateAiUsageCost, normalizeAiUsage } from "./ai-usage-tokens.ts";

const NOW = new Date("2026-09-03T12:00:00.000Z");
let db: Client;
const migration = (name: string) => readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");

beforeEach(async () => {
  db = createClient({ url: "file::memory:" });
  await db.executeMultiple(migration("001_ea_tables.sql"));
  await db.executeMultiple(migration("057_email_ai_usage.sql"));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

function event(overrides: Partial<AiUsageEvent> = {}): AiUsageEvent {
  const tokens = normalizeAiUsage("openai", { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } });
  return {
    eventId: "call-1", userId: "owner", runId: "run-1", runContext: "production", origin: "background_triage",
    provider: "openai", model: "gpt-5.4-nano", purpose: "triage_cheap",
    startedAt: "2026-09-03T11:00:00.000Z", finishedAt: "2026-09-03T11:00:01.000Z",
    providerLatencyMs: 1000, outcome: "succeeded", httpStatus: 200,
    ...tokens, ...estimateAiUsageCost("openai", "gpt-5.4-nano", tokens), ...overrides,
  };
}

describe("durable email AI call ledger", () => {
  it("records an attempt idempotently, permits finalization, and never regresses terminal outcomes", async () => {
    await recordAiUsageEvent(event({ outcome: "response_received" }), { dbClient: db });
    await Promise.all(Array.from({ length: 4 }, () => recordAiUsageEvent(event({ outcome: "parse_error" }), { dbClient: db })));
    await recordAiUsageEvent(event({ outcome: "response_received" }), { dbClient: db });
    await recordAiUsageEvent(event({ userId: "another-owner", outcome: "succeeded" }), { dbClient: db });
    const stats = await getEmailAiUsageStats("owner", { dbClient: db, now: NOW });
    expect(stats.contexts.production.triage).toMatchObject({ calls: 1, failures: 1, inputTokens: 100, pendingCalls: 0 });
    expect((await db.execute("SELECT outcome, user_id FROM ea_ai_usage_events")).rows).toEqual([
      { outcome: "parse_error", user_id: "owner" },
    ]);
  });

  it("isolates owner, exact time window, run context and financial purposes", async () => {
    const fixtures: Partial<AiUsageEvent>[] = [
      {}, { eventId: "audit", purpose: "verification", providerLatencyMs: 3000 },
      { eventId: "eval", purpose: "matching", runContext: "evaluation" },
      { eventId: "other", userId: "other" },
      { eventId: "old", startedAt: "2026-08-27T11:59:59.999Z" },
      { eventId: "edge", startedAt: "2026-08-27T12:00:00.000Z" },
      { eventId: "future", startedAt: "2026-09-03T12:00:00.001Z" },
    ];
    for (const item of fixtures) await recordAiUsageEvent(event(item), { dbClient: db });
    const stats = await getEmailAiUsageStats("owner", { dbClient: db, now: NOW });
    expect(stats.contexts.production.triage.calls).toBe(2);
    expect(stats.contexts.production.financialEmail).toMatchObject({ calls: 1, averageProviderLatencyMs: 3000, byPurpose: { verification: { calls: 1 } } });
    expect(stats.contexts.evaluation.financialEmail).toMatchObject({ calls: 1, byPurpose: { matching: { calls: 1 } } });
    expect(stats.contexts.evaluation.triage.calls).toBe(0);
  });

  it("keeps unknown measurements and partial estimates distinguishable from a measured zero", async () => {
    await recordAiUsageEvent(event({
      ...normalizeAiUsage("openai", undefined), estimatedCostUsd: null, pricingVersion: null,
      purpose: "extraction", outcome: "provider_error",
    }), { dbClient: db });
    let financial = (await getEmailAiUsageStats("owner", { dbClient: db, now: NOW })).contexts.production.financialEmail;
    expect(financial).toMatchObject({ calls: 1, failures: 1, inputTokens: null, estimatedCostUsd: null, missingUsageCalls: 1, unpricedCalls: 1 });
    await recordAiUsageEvent(event({ eventId: "known", purpose: "matching" }), { dbClient: db });
    financial = (await getEmailAiUsageStats("owner", { dbClient: db, now: NOW })).contexts.production.financialEmail;
    expect(financial).toMatchObject({ calls: 2, inputTokens: 100, missingUsageCalls: 1, unpricedCalls: 1 });
    expect(financial.estimatedCostUsd).toBeGreaterThan(0);
    await recordAiUsageEvent(event({ eventId: "unknown-model", model: "future-model", estimatedCostUsd: null }), { dbClient: db });
    const triage = (await getEmailAiUsageStats("owner", { dbClient: db, now: NOW })).contexts.production.triage;
    expect(triage).toMatchObject({ inputTokens: 100, missingUsageCalls: 0, unpricedCalls: 1, estimatedCostUsd: null });
  });

  it("persists usage before parsing, retains it after downstream failure, and separates provider timing", async () => {
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const work = withAiUsageContext({ userId: "owner", origin: "manual_extraction", dbClient: db }, async () => {
      await trackedAiProviderCall({ provider: "openai", model: "gpt-5.4-nano", purpose: "extraction" }, async (call) => {
        clock = 110;
        await call.capture({ usage: { input_tokens: 10, output_tokens: 2 }, model: "gpt-5.4-nano" });
        expect((await db.execute("SELECT outcome, input_tokens FROM ea_ai_usage_events")).rows).toEqual([
          { outcome: "response_received", input_tokens: 10 },
        ]);
        return "parsed";
      });
      clock = 9999;
      throw new Error("later planning failed");
    });
    await expect(work).rejects.toThrow("later planning failed");
    const rows = (await db.execute("SELECT outcome, input_tokens, provider_latency_ms FROM ea_ai_usage_events")).rows;
    expect(rows[0]).toMatchObject({ outcome: "succeeded", input_tokens: 10 });
    expect(Number(rows[0]?.provider_latency_ms)).toBe(10);
  });

  it("recording failure does not interrupt the model result or replace its error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = createClient({ url: "file::memory:" });
    broken.close();
    const run = (fail: boolean) => withAiUsageContext({ userId: "owner", origin: "manual_extraction", dbClient: broken }, () =>
      trackedAiProviderCall({ provider: "openai", model: "gpt-5.4-nano", purpose: "extraction" }, async (call) => {
        await call.capture({ usage: { input_tokens: 0, output_tokens: 0 } });
        if (fail) throw new Error("original parser failure");
        return "successful extraction";
      }));
    await expect(run(false)).resolves.toBe("successful extraction");
    await expect(run(true)).rejects.toThrow("original parser failure");
  });

  it("bounds a hung recorder and recovers from a failed first write without duplicating usage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hungDb = { execute: async () => new Promise<{ rows: Record<string, unknown>[] }>(() => {}) };
    const result = withAiUsageContext({ userId: "owner", origin: "manual_extraction", dbClient: hungDb }, () =>
      trackedAiProviderCall({ provider: "openai", model: "gpt-5.4", purpose: "extraction" }, async (call) => {
        await call.capture({ usage: { input_tokens: 5, output_tokens: 1 } });
        return "extracted";
      }));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toBe("extracted");
    vi.useRealTimers();
    let firstWrite = true;
    const recoveringDb = { execute: async (statement: Parameters<Client["execute"]>[0]) => {
      if (firstWrite) { firstWrite = false; throw new Error("temporary DB outage"); }
      return db.execute(statement);
    } };
    await withAiUsageContext({ userId: "owner", origin: "manual_extraction", dbClient: recoveringDb }, () =>
      trackedAiProviderCall({ provider: "openai", model: "gpt-5.4", purpose: "extraction" }, async (call) => {
        await call.capture({ usage: { input_tokens: 5, output_tokens: 1 } });
      }));
    expect((await db.execute("SELECT outcome, input_tokens FROM ea_ai_usage_events")).rows).toEqual([
      { outcome: "succeeded", input_tokens: 5 },
    ]);
  });

  it.each(["success", "parse failure", "transport failure"])("skips all evaluation database changes on %s without changing the provider outcome", async (outcome) => {
    const before = (await db.execute("SELECT total_changes() AS count")).rows;
    const error = new Error(outcome);
    const result = withAiUsageContext({ userId: "owner", origin: "evaluation", runContext: "evaluation", dbClient: db }, () =>
      trackedAiProviderCall({ provider: "openai", model: "gpt-5.4", purpose: "extraction" }, async (call) => {
        if (outcome === "transport failure") throw error;
        call.setHttpStatus(200);
        await call.capture({ usage: { input_tokens: 100, output_tokens: 20 } });
        if (outcome === "parse failure") throw error;
        return "extracted";
      }));
    if (outcome === "success") await expect(result).resolves.toBe("extracted");
    else await expect(result).rejects.toBe(error);
    expect((await db.execute("SELECT total_changes() AS count")).rows).toEqual(before);
    expect((await db.execute("SELECT * FROM ea_ai_usage_events")).rows).toEqual([]);
  });

  it("keeps nested evaluation calls out of the ledger while recording independent concurrent production calls", async () => {
    const call = () => trackedAiProviderCall({ provider: "anthropic", model: "claude-haiku-4-5", purpose: "verification" }, async (capture) => {
      await capture.capture({ usage: { input_tokens: 10, output_tokens: 2 } });
    });
    await Promise.all([
      withAiUsageContext({ userId: "owner", origin: "evaluation", runContext: "evaluation", runId: "eval-run", dbClient: db }, () =>
        withAiUsageContext({ userId: "owner", origin: "background_triage" }, call)),
      withAiUsageContext({ userId: "owner", origin: "reader_adoption", runId: "reader-run", dbClient: db }, call),
    ]);
    expect((await db.execute("SELECT run_id, run_context, origin FROM ea_ai_usage_events ORDER BY run_id")).rows).toEqual([
      { run_id: "reader-run", run_context: "production", origin: "reader_adoption" },
    ]);
  });

  it("freezes legacy usage once without copying private decisions or overlapping re-triage events", async () => {
    const legacyDb = createClient({ url: "file::memory:" });
    try {
      await legacyDb.executeMultiple(migration("001_ea_tables.sql"));
      const usage = { input_tokens: 120, output_tokens: 25 };
      await legacyDb.execute({
        sql: `INSERT INTO ea_email_triage (user_id, account_id, email_id, last_triaged_at, model_usage_json, cheap_model_result_json)
          VALUES ('owner', 'mail', 'email', ?, ?, ?)`,
        args: [NOW.toISOString(), JSON.stringify({ cheap: usage }), JSON.stringify({ provider: "openai", model: "gpt-5.4-nano", usage, decision: { summary: "private email content" } })],
      });
      await legacyDb.executeMultiple(migration("057_email_ai_usage.sql"));
      await legacyDb.execute("UPDATE ea_email_triage SET model_usage_json = '{\"cheap\":{\"input_tokens\":9999}}'");
      await recordAiUsageEvent(event(), { dbClient: legacyDb });
      const legacy = await getTriageCacheStats("owner", { dbClient: legacyDb, now: NOW });
      const current = await getEmailAiUsageStats("owner", { dbClient: legacyDb, now: NOW });
      expect(legacy).toMatchObject({ openaiCalls: 1, inputTokens: 120, outputTokens: 25 });
      expect(current.contexts.production.triage).toMatchObject({ calls: 1, inputTokens: 100 });
      expect(JSON.stringify((await legacyDb.execute("SELECT * FROM ea_ai_usage_legacy_triage")).rows)).not.toContain("private email content");
    } finally { legacyDb.close(); }
  });
});

describe("provider token and pricing semantics", () => {
  it("normalizes OpenAI cache reads as part of input and Anthropic reads/writes as additional input", () => {
    const openai = normalizeAiUsage("openai", { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 600 } });
    expect(openai).toMatchObject({ inputTokens: 1000, cachedInputTokens: 600, cacheCreationInputTokens: 0 });
    expect(estimateAiUsageCost("openai", "gpt-5.4-nano-2026-03-17", openai).estimatedCostUsd).toBeCloseTo(0.000217);
    const openaiWrites = normalizeAiUsage("openai", {
      input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 },
    });
    expect(openaiWrites).toMatchObject({ inputTokens: 1000, cacheCreationInputTokens: 300 });
    expect(estimateAiUsageCost("openai", "gpt-5.6-sol", openaiWrites).estimatedCostUsd).toBeCloseTo(0.00414);
    const anthropic = normalizeAiUsage("anthropic", {
      input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 600, cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
    });
    expect(anthropic).toMatchObject({ inputTokens: 1000, cachedInputTokens: 600, cacheCreationInputTokens: 300 });
    expect(estimateAiUsageCost("anthropic", "claude-haiku-4-5-20251001", anthropic).estimatedCostUsd).toBeCloseTo(0.00066);
  });

  it("does not price unknown variants, malformed or absent usage, or unsupported tiers", () => {
    const zero = normalizeAiUsage("openai", { input_tokens: 0, output_tokens: 0 });
    expect(estimateAiUsageCost("openai", "gpt-5.4", zero).estimatedCostUsd).toBe(0);
    expect(estimateAiUsageCost("openai", "gpt-5.4-pro", zero).estimatedCostUsd).toBeNull();
    expect(estimateAiUsageCost("openai", "gpt-5.4", zero, "priority").estimatedCostUsd).toBeNull();
    for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 2 }, { input_tokens: "3", output_tokens: 2 }]) {
      expect(estimateAiUsageCost("openai", "gpt-5.4", normalizeAiUsage("openai", usage)).estimatedCostUsd).toBeNull();
    }
    expect(normalizeAiUsage("openai", undefined).inputTokens).toBeNull();
    const malformedDetails = normalizeAiUsage("openai", { input_tokens: 100, output_tokens: 10, input_tokens_details: "corrupt" });
    expect(malformedDetails.cachedInputTokens).toBeNull();
    expect(estimateAiUsageCost("openai", "gpt-5.4", malformedDetails).estimatedCostUsd).toBeNull();
    const malformedTtl = normalizeAiUsage("anthropic", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 30, cache_creation: "corrupt" });
    expect(estimateAiUsageCost("anthropic", "claude-haiku-4-5", malformedTtl).estimatedCostUsd).toBeNull();
  });
});
