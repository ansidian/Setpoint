import { it, expect } from "vitest";
import { getAlfredUsageStats } from "./alfred-usage-stats.js";

function fakeDb(rows) {
  return { execute: async () => ({ rows }) };
}

const NOW = new Date("2026-06-14T00:00:00Z");

function turn({ conv, model = "claude-sonnet-4-6", input = 0, cached = 0, output = 0, at }) {
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
function toolCall({ tool, ok = true, duration = 100, at }) {
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

it("aggregates queries, tokens, cache hit, savings, model split, and tools", async () => {
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
  expect(stats.estimatedSavingsUsd).toBeGreaterThan(0);
  expect(stats.byModel["claude-sonnet-4-6"].calls).toBe(3);
  expect(stats.tools.totalCalls).toBe(3);
  expect(stats.tools.distinctTools).toBe(2);
  const search = stats.tools.byTool.find((t) => t.name === "search_email");
  expect(search.calls).toBe(2);
  expect(search.errors).toBe(1);
  expect(search.errorRate).toBeCloseTo(0.5, 4);
  expect(search.avgDurationMs).toBe(100);
});

it("returns an empty summary when the table is missing", async () => {
  const db = { execute: async () => { throw new Error("no such table: ea_alfred_usage"); } };
  const stats = await getAlfredUsageStats("u1", { dbClient: db, now: NOW });
  expect(stats.queries).toBe(0);
  expect(stats.tools.totalCalls).toBe(0);
});
