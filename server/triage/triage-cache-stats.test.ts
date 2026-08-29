import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { getTriageCacheStats } from "./triage-cache-stats.ts";

// Deterministic in-memory db stub: returns a fixed row set regardless of the
// SQL/args, so the model test exercises pure aggregation rather than Turso.
function fakeDb(rows: Record<string, unknown>[]) {
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
}: {
  lastTriagedAt: string;
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  provider?: string;
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
}: {
  lastTriagedAt: string;
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  provider?: string;
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
  it("aggregates OpenAI usage by tier", async () => {
    const stats = await getTriageCacheStats("user-1", {
      dbClient: fakeDb([strongRow({ lastTriagedAt: "2026-05-04T12:00:00.000Z" })]),
      now: NOW,
    });

    expect(stats.openaiCalls).toBe(1);
    expect(stats.inputTokens).toBe(2000);
    expect(stats.cachedInputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(200);
    expect(stats.models).toEqual(["gpt-5.4"]);
    expect(stats.byTier.strong.calls).toBe(1);
    expect(stats.byTier.cheap.calls).toBe(0);
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

  it("queries the durable wider cutoff without leaking another user's rows", async () => {
    const db = createClient({ url: "file::memory:" });
    try {
      await db.executeMultiple(readFileSync(
        new URL("../db/migrations/001_ea_tables.sql", import.meta.url),
        "utf8",
      ));
      const atCutoff = cheapRow({ lastTriagedAt: "2026-04-30T12:00:00.000Z" });
      const beforeCutoff = cheapRow({ lastTriagedAt: "2026-04-30T11:59:59.000Z" });
      await db.batch([
        {
          sql: `INSERT INTO ea_email_triage
                  (user_id, account_id, email_id, last_triaged_at, model_usage_json,
                   cheap_model_result_json, strong_model_result_json)
                VALUES ('user-42', 'gmail', 'at-cutoff', ?, ?, ?, ?)`,
          args: [atCutoff.last_triaged_at, atCutoff.model_usage_json, atCutoff.cheap_model_result_json, null],
        },
        {
          sql: `INSERT INTO ea_email_triage
                  (user_id, account_id, email_id, last_triaged_at, model_usage_json,
                   cheap_model_result_json, strong_model_result_json)
                VALUES ('user-42', 'gmail', 'before-cutoff', ?, ?, ?, ?)`,
          args: [beforeCutoff.last_triaged_at, beforeCutoff.model_usage_json, beforeCutoff.cheap_model_result_json, null],
        },
        {
          sql: `INSERT INTO ea_email_triage
                  (user_id, account_id, email_id, last_triaged_at, model_usage_json,
                   cheap_model_result_json, strong_model_result_json)
                VALUES ('other-user', 'gmail', 'other', ?, ?, ?, ?)`,
          args: [atCutoff.last_triaged_at, atCutoff.model_usage_json, atCutoff.cheap_model_result_json, null],
        },
      ]);

      const stats = await getTriageCacheStats("user-42", { dbClient: db, windowDays: 7, now: NOW });

      // queryCutoff = min(rolling 2026-04-30T12:00, month 2026-05-01T00:00).
      expect(stats.openaiCalls).toBe(1);
      expect(stats.comparisonWindows.monthToDate.openaiCalls).toBe(0);
    } finally {
      await db.close();
    }
  });
});
