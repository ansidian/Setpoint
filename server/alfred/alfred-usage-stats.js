import db from "../db/connection.ts";

const DEFAULT_WINDOW_DAYS = 7;

// Anthropic pricing per 1M tokens. cachedInput ≈ 0.1× input (cache-read economics).
const ANTHROPIC_PRICE_PER_MILLION = {
  "claude-sonnet-4-6": { input: 3.00, cachedInput: 0.30, output: 15.00 },
  "claude-haiku-4-5": { input: 1.00, cachedInput: 0.10, output: 5.00 },
};
const PRICE_MODEL_KEYS = Object.keys(ANTHROPIC_PRICE_PER_MILLION)
  .sort((left, right) => right.length - left.length);

function priceForModel(model) {
  const modelId = String(model || "");
  const exact = ANTHROPIC_PRICE_PER_MILLION[modelId];
  if (exact) return exact;
  const base = PRICE_MODEL_KEYS.find((key) => modelId.startsWith(`${key}-`));
  return base ? ANTHROPIC_PRICE_PER_MILLION[base] : null;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function tokenCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function roundMoney(value) { return Math.round(Number(value || 0) * 1_000_000) / 1_000_000; }
function roundRate(value) { return Math.round(Number(value || 0) * 10_000) / 10_000; }

function monthToDateCutoff(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function emptyByModel() {
  return { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

function summarizeRows(rows, { windowDays, windowLabel, cutoff, now }) {
  const cutoffMs = cutoff.getTime();
  const summary = {
    windowDays,
    windowLabel,
    generatedAt: now.toISOString(),
    queries: 0,
    turns: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    cacheHitRate: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
    lastUsedAt: null,
    byModel: {},
    tools: { totalCalls: 0, distinctTools: 0, byTool: [] },
  };

  const conversationIds = new Set();
  const toolMap = new Map();

  for (const row of rows) {
    const at = Date.parse(row.created_at || "");
    if (!Number.isFinite(at) || at < cutoffMs) continue;
    if (row.created_at && (!summary.lastUsedAt || row.created_at > summary.lastUsedAt)) {
      summary.lastUsedAt = row.created_at;
    }

    if (row.event_type === "alfred_run_turn") {
      const meta = safeJson(row.metadata_json);
      if (meta.conversation_id) conversationIds.add(meta.conversation_id);
      summary.turns += 1;
      const input = tokenCount(row.input_tokens);
      const cached = tokenCount(row.cached_input_tokens);
      const output = tokenCount(row.output_tokens);
      summary.inputTokens += input;
      summary.cachedInputTokens += cached;
      summary.outputTokens += output;

      const price = priceForModel(row.model);
      const uncached = Math.max(0, input - cached);
      const cost = price
        ? (uncached / 1e6) * price.input + (cached / 1e6) * price.cachedInput + (output / 1e6) * price.output
        : 0;
      const savings = price ? (cached / 1e6) * (price.input - price.cachedInput) : 0;
      summary.estimatedCostUsd += cost;
      summary.estimatedSavingsUsd += savings;

      const model = row.model || "unknown";
      if (!summary.byModel[model]) summary.byModel[model] = emptyByModel();
      const m = summary.byModel[model];
      m.calls += 1;
      m.inputTokens += input;
      m.cachedInputTokens += cached;
      m.outputTokens += output;
      m.estimatedCostUsd += cost;
    } else if (row.event_type === "alfred_tool_call") {
      const meta = safeJson(row.metadata_json);
      const name = meta.tool || "unknown";
      if (!toolMap.has(name)) toolMap.set(name, { name, calls: 0, errors: 0, totalDurationMs: 0 });
      const entry = toolMap.get(name);
      entry.calls += 1;
      if (meta.ok === false) entry.errors += 1;
      entry.totalDurationMs += tokenCount(meta.duration_ms);
    }
  }

  summary.queries = conversationIds.size;
  summary.cacheHitRate = summary.inputTokens
    ? roundRate(summary.cachedInputTokens / summary.inputTokens)
    : 0;
  summary.estimatedCostUsd = roundMoney(summary.estimatedCostUsd);
  summary.estimatedSavingsUsd = roundMoney(summary.estimatedSavingsUsd);
  for (const m of Object.values(summary.byModel)) m.estimatedCostUsd = roundMoney(m.estimatedCostUsd);

  const byTool = [...toolMap.values()].map((t) => ({
    name: t.name,
    calls: t.calls,
    errors: t.errors,
    errorRate: t.calls ? roundRate(t.errors / t.calls) : 0,
    avgDurationMs: t.calls ? Math.round(t.totalDurationMs / t.calls) : 0,
  })).sort((a, b) => b.calls - a.calls);
  summary.tools = {
    totalCalls: byTool.reduce((sum, t) => sum + t.calls, 0),
    distinctTools: byTool.length,
    byTool,
  };

  return summary;
}

function compactWindow(summary) {
  return {
    windowDays: summary.windowDays,
    windowLabel: summary.windowLabel,
    queries: summary.queries,
    turns: summary.turns,
    inputTokens: summary.inputTokens,
    cachedInputTokens: summary.cachedInputTokens,
    outputTokens: summary.outputTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
    estimatedSavingsUsd: summary.estimatedSavingsUsd,
    cacheHitRate: summary.cacheHitRate,
  };
}

export async function getAlfredUsageStats(userId, {
  dbClient = db,
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const windowCutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const monthCutoff = monthToDateCutoff(now);
  const queryCutoff = new Date(Math.min(windowCutoff.getTime(), monthCutoff.getTime()));

  let rows = [];
  try {
    const result = await dbClient.execute({
      sql: `SELECT created_at, event_type, model, input_tokens, cached_input_tokens,
                   output_tokens, metadata_json
            FROM ea_alfred_usage
            WHERE user_id = ? AND created_at >= ?`,
      args: [userId, queryCutoff.toISOString()],
    });
    rows = result.rows || [];
  } catch (err) {
    if (!/no such table/i.test(String(err?.message || ""))) throw err;
  }

  const summary = summarizeRows(rows, {
    windowDays,
    windowLabel: "rolling",
    cutoff: windowCutoff,
    now,
  });
  const monthToDate = summarizeRows(rows, {
    windowDays: null,
    windowLabel: "month_to_date",
    cutoff: monthCutoff,
    now,
  });
  summary.comparisonWindows = { monthToDate: compactWindow(monthToDate) };
  return summary;
}
