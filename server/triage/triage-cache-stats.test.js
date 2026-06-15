import { describe, expect, it } from "vitest";
import { getTriageCacheStats } from "./triage-cache-stats.js";

// Deterministic in-memory db stub: returns a fixed row set regardless of the
// SQL/args, so the model test exercises pure aggregation rather than Turso.
function fakeDb(rows) {
  return {
    execute: async () => ({ rows }),
  };
}

function cheapRow({
  lastTriagedAt,
  model = "gpt-5.4-nano",
  inputTokens = 1000,
  cachedTokens = 600,
  outputTokens = 100,
  provider = "openai",
}) {
  return {
    last_triaged_at: lastTriagedAt,
    model_usage_json: JSON.stringify({
      cheap: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        prompt_tokens_details: { cached_tokens: cachedTokens },
      },
    }),
    cheap_model_result_json: JSON.stringify({ provider, model, tier: "cheap" }),
    strong_model_result_json: null,
  };
}

function strongRow({
  lastTriagedAt,
  model = "gpt-5.4",
  inputTokens = 2000,
  cachedTokens = 1000,
  outputTokens = 200,
  provider = "openai",
}) {
  return {
    last_triaged_at: lastTriagedAt,
    model_usage_json: JSON.stringify({
      strong: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        input_tokens_details: { cached_tokens: cachedTokens },
      },
    }),
    cheap_model_result_json: null,
    strong_model_result_json: JSON.stringify({ provider, model, tier: "strong" }),
  };
}

const NOW = new Date("2026-05-07T12:00:00.000Z");

describe("getTriageCacheStats", () => {
  it("prices an exactly-matched OpenAI model and computes cost + savings", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([strongRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" })]),
      now: NOW,
    });

    // gpt-5.4: input 2.50, cachedInput 0.25, output 15.00 per million.
    // uncached = 2000 - 1000 = 1000.
    // cost = 1000/1e6*2.50 + 1000/1e6*0.25 + 200/1e6*15.00 = 0.00575
    // savings = 1000/1e6*(2.50-0.25) = 0.00225
    expect(stats.openaiCalls).toBe(1);
    expect(stats.inputTokens).toBe(2000);
    expect(stats.cachedInputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(200);
    expect(stats.estimatedCostUsd).toBe(0.00575);
    expect(stats.estimatedSavingsUsd).toBe(0.00225);
    expect(stats.models).toEqual(["gpt-5.4"]);
    expect(stats.byTier.strong.calls).toBe(1);
    expect(stats.byTier.cheap.calls).toBe(0);
  });

  it("prices a dated model id via the longest startsWith prefix", async () => {
    // "gpt-5.4-nano-2026-05-04" has no exact entry; it must resolve to the
    // "gpt-5.4-nano" prefix, NOT the shorter "gpt-5.4" prefix.
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([
        cheapRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z", model: "gpt-5.4-nano-2026-05-04" }),
      ]),
      now: NOW,
    });

    // gpt-5.4-nano: input 0.20, cachedInput 0.02, output 1.25 per million.
    // uncached = 1000 - 600 = 400.
    // cost = 400/1e6*0.20 + 600/1e6*0.02 + 100/1e6*1.25 = 0.000217
    // savings = 600/1e6*(0.20-0.02) = 0.000108
    expect(stats.byTier.cheap.estimatedCostUsd).toBe(0.000217);
    expect(stats.byTier.cheap.estimatedSavingsUsd).toBe(0.000108);
    expect(stats.models).toEqual(["gpt-5.4-nano-2026-05-04"]);
  });

  it("treats an unknown OpenAI model as zero-priced (no exact, no prefix match)", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([
        cheapRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z", model: "gpt-9-experimental" }),
      ]),
      now: NOW,
    });

    // Tokens still accumulate; only cost/savings are zero with no price row.
    expect(stats.openaiCalls).toBe(1);
    expect(stats.inputTokens).toBe(1000);
    expect(stats.cachedInputTokens).toBe(600);
    expect(stats.estimatedCostUsd).toBe(0);
    expect(stats.estimatedSavingsUsd).toBe(0);
  });

  it("excludes anthropic-provider rows from the OpenAI aggregate", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([
        cheapRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" }),
        cheapRow({
          lastTriagedAt: "2026-05-04T12:10:00.000Z",
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          inputTokens: 999,
          cachedTokens: 0,
          outputTokens: 99,
        }),
      ]),
      now: NOW,
    });

    // Only the single OpenAI row counts; the anthropic row's 999/99 tokens drop.
    expect(stats.openaiCalls).toBe(1);
    expect(stats.inputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(100);
    expect(stats.models).toEqual(["gpt-5.4-nano"]);
  });

  it("rounds money to 6 places and the cache hit rate to 4 places", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([
        cheapRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" }), // 1000 in / 600 cached
        strongRow({ lastTriagedAt: "2026-05-04T12:05:00.000Z" }), // 2000 in / 1000 cached
      ]),
      now: NOW,
    });

    // hitRate = 1600/3000 = 0.53333... -> roundRate -> 0.5333
    expect(stats.hitRate).toBe(0.5333);
    // total cost = 0.000217 + 0.00575 = 0.005967 (rounded to 6 places)
    expect(stats.estimatedCostUsd).toBe(0.005967);
    expect(stats.estimatedSavingsUsd).toBe(0.002358);
    // lastTriagedAt is the max across counted rows.
    expect(stats.lastTriagedAt).toBe("2026-05-04T12:05:00.000Z");
  });

  it("reports a zero hit rate when there are no input tokens", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([]),
      now: NOW,
    });

    expect(stats.openaiCalls).toBe(0);
    expect(stats.inputTokens).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.lastTriagedAt).toBeNull();
    expect(stats.models).toEqual([]);
  });

  it("splits the rolling window from month-to-date by last_triaged_at", async () => {
    // now = 2026-05-07; windowDays = 7 -> rolling cutoff = 2026-04-30T12:00.
    // month-to-date cutoff = 2026-05-01T00:00 (UTC).
    // - inWindow: 2026-05-04 counts in BOTH rolling and MTD.
    // - aprilRow: 2026-04-25 is inside the 7-day query span only via... no:
    //   query cutoff = min(rolling, month) = 2026-04-30T12:00, so 2026-04-25 is
    //   NOT returned by the query at all. Use 2026-04-30T18:00 instead, which
    //   is after the rolling cutoff (in rolling) but before the month cutoff
    //   (NOT in month-to-date) -- proving the two windows diverge.
    const stats = await getTriageCacheStats("user-1", {
      windowDays: 7,
      dbClient: fakeDb([
        strongRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" }), // both windows
        cheapRow({ lastTriagedAt: "2026-04-30T18:00:00.000Z" }), // rolling only
      ]),
      now: NOW,
    });

    // Rolling window sees both rows.
    expect(stats.windowDays).toBe(7);
    expect(stats.windowLabel).toBe("rolling");
    expect(stats.openaiCalls).toBe(2);

    // Month-to-date drops the 2026-04-30 row (before the 1st).
    expect(stats.comparisonWindows.monthToDate).toMatchObject({
      windowDays: null,
      windowLabel: "month_to_date",
      openaiCalls: 1,
      inputTokens: 2000,
    });
  });

  it("respects a custom windowDays for the rolling cutoff", async () => {
    // windowDays = 1 -> rolling cutoff = 2026-05-06T12:00. A 2026-05-04 row is
    // outside the rolling window but still inside month-to-date.
    const stats = await getTriageCacheStats("user-1", {
      windowDays: 1,
      dbClient: fakeDb([strongRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" })]),
      now: NOW,
    });

    expect(stats.windowDays).toBe(1);
    expect(stats.openaiCalls).toBe(0);
    expect(stats.comparisonWindows.monthToDate.openaiCalls).toBe(1);
  });

  it("passes the wider of the two cutoffs to the SQL query", async () => {
    let capturedArgs = null;
    const dbClient = {
      execute: async ({ args }) => {
        capturedArgs = args;
        return { rows: [] };
      },
    };

    await getTriageCacheStats("user-42", { dbClient, windowDays: 7, now: NOW });

    // queryCutoff = min(rolling 2026-04-30T12:00, month 2026-05-01T00:00)
    //             = 2026-04-30T12:00 (the rolling cutoff is wider this month).
    expect(capturedArgs[0]).toBe("user-42");
    expect(capturedArgs[1]).toBe("2026-04-30T12:00:00.000Z");
  });
});
