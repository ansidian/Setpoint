import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { expect, it } from "vitest";
import { getAlfredUsageStats } from "./alfred-usage-stats.ts";
import type { AlfredUsageStatsDb } from "./alfred-usage-stats.ts";

type UsageTestRow = {
  created_at: string;
  event_type: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  metadata_json: string;
};

function fakeDb(rows: UsageTestRow[]): AlfredUsageStatsDb {
  return { execute: async () => ({ rows }) };
}

const NOW = new Date("2026-06-14T00:00:00Z");

function turn({ conv, model = "claude-sonnet-4-6", input = 0, cached = 0, output = 0, at }: {
  conv: string;
  model?: string;
  input?: number;
  cached?: number;
  output?: number;
  at: string;
}): UsageTestRow {
  return {
    created_at: at,
    event_type: "alfred_run_turn",
    model,
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    metadata_json: JSON.stringify({ conversation_id: conv }),
  };
}
function toolCall({ tool, ok = true, duration = 100, at }: {
  tool: string;
  ok?: boolean;
  duration?: number;
  at: string;
}): UsageTestRow {
  return {
    created_at: at,
    event_type: "alfred_tool_call",
    model: "claude-sonnet-4-6",
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    metadata_json: JSON.stringify({ tool, ok, duration_ms: duration }),
  };
}

it("aggregates queries, tokens, cache hit, model split, and tools", async () => {
  const at = "2026-06-13T12:00:00Z";
  const db = fakeDb([
    turn({ conv: "a", input: 1000, cached: 800, output: 50, at }),
    turn({ conv: "a", input: 1200, cached: 1000, output: 40, at }),
    turn({ conv: "b", input: 500, cached: 0, output: 20, at }),
    toolCall({ tool: "search_email", ok: true, duration: 120, at }),
    toolCall({ tool: "search_email", ok: false, duration: 80, at }),
    toolCall({ tool: "get_calendar_events", ok: true, duration: 40, at }),
  ]);

  const stats = await getAlfredUsageStats("u1", { dbClient: db, now: NOW });

  expect(stats.queries).toBe(2); // distinct conversation ids
  expect(stats.turns).toBe(3);
  expect(stats.inputTokens).toBe(2700);
  expect(stats.cachedInputTokens).toBe(1800);
  expect(stats.cacheHitRate).toBeCloseTo(1800 / 2700, 4);
  expect(stats.byModel["claude-sonnet-4-6"]!.calls).toBe(3);
  expect(stats.tools.totalCalls).toBe(3);
  expect(stats.tools.distinctTools).toBe(2);
  const search = stats.tools.byTool.find((t) => t.name === "search_email");
  expect(search!.calls).toBe(2);
  expect(search!.errors).toBe(1);
  expect(search!.errorRate).toBeCloseTo(0.5, 4);
  expect(search!.avgDurationMs).toBe(100);
});

it("returns an empty summary when the table is missing", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    const stats = await getAlfredUsageStats("u1", { dbClient: db, now: NOW });
    expect(stats.queries).toBe(0);
    expect(stats.tools.totalCalls).toBe(0);
  } finally {
    await db.close();
  }
});

it("scopes a same-month row older than the rolling window to month-to-date only", async () => {
  // NOW is 2026-06-14: rolling cutoff = 2026-06-07, month cutoff = 2026-06-01.
  // A turn dated 2026-06-03 is inside the month but older than the 7-day window.
  const inWindow = "2026-06-13T12:00:00Z"; // both windows
  const earlyThisMonth = "2026-06-03T12:00:00Z"; // month-to-date only
  const db = fakeDb([
    turn({ conv: "recent", input: 1000, cached: 0, output: 10, at: inWindow }),
    turn({ conv: "early", input: 4000, cached: 0, output: 90, at: earlyThisMonth }),
  ]);

  const stats = await getAlfredUsageStats("u1", { dbClient: db, now: NOW });

  // Rolling window excludes the early-month row.
  expect(stats.windowLabel).toBe("rolling");
  expect(stats.queries).toBe(1);
  expect(stats.turns).toBe(1);
  expect(stats.inputTokens).toBe(1000);

  // Month-to-date includes both rows.
  const mtd = stats.comparisonWindows.monthToDate;
  expect(mtd.windowLabel).toBe("month_to_date");
  expect(mtd.queries).toBe(2);
  expect(mtd.turns).toBe(2);
  expect(mtd.inputTokens).toBe(5000);
});

it("queries durable usage with owner and wider-cutoff isolation", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.executeMultiple(readFileSync(
      new URL("../db/migrations/016_alfred_usage.sql", import.meta.url),
      "utf8",
    ));
    const recent = turn({ conv: "owned", input: 100, at: "2026-06-13T12:00:00Z" });
    const beforeCutoff = turn({ conv: "old", input: 900, at: "2026-05-31T23:59:59Z" });
    const statements = [
      { userId: "u1", row: recent },
      { userId: "u1", row: beforeCutoff },
      { userId: "other-user", row: recent },
    ].map(({ userId, row }) => ({
      sql: `INSERT INTO ea_alfred_usage
              (user_id, event_type, model, input_tokens, cached_input_tokens,
               output_tokens, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        row.event_type,
        row.model,
        row.input_tokens,
        row.cached_input_tokens,
        row.output_tokens,
        row.metadata_json,
        row.created_at,
      ],
    }));
    await db.batch(statements);

    const stats = await getAlfredUsageStats("u1", { dbClient: db, now: NOW });

    expect(stats.queries).toBe(1);
    expect(stats.turns).toBe(1);
    expect(stats.inputTokens).toBe(100);
    expect(stats.comparisonWindows.monthToDate.turns).toBe(1);
  } finally {
    await db.close();
  }
});
