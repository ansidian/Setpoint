import db from "../db/connection.ts";
import type { InStatement } from "@libsql/client";
import type {
  AlfredUsageModelSummary,
  AlfredUsageStats,
  AlfredUsageToolSummary,
  AlfredUsageWindow,
} from "../../shared/types/alfred.ts";

const DEFAULT_WINDOW_DAYS = 7;

// Standard text pricing per 1M tokens. Long-context and regional uplifts remain
// outside this estimate, matching the existing analytics contract.
type ModelPrice = { input: number; cachedInput: number; output: number };
const MODEL_PRICE_PER_MILLION: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { input: 3.00, cachedInput: 0.30, output: 15.00 },
  "claude-haiku-4-5": { input: 1.00, cachedInput: 0.10, output: 5.00 },
  "gpt-5.6-sol": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.6-terra": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.6-luna": { input: 1.00, cachedInput: 0.10, output: 6.00 },
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.5-pro": { input: 30.00, cachedInput: 30.00, output: 180.00 },
  "gpt-5.4": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-pro": { input: 30.00, cachedInput: 30.00, output: 180.00 },
};
const PRICE_MODEL_KEYS = Object.keys(MODEL_PRICE_PER_MILLION)
  .sort((left, right) => right.length - left.length);

function priceForModel(model: unknown): ModelPrice | null {
  const modelId = String(model || "");
  const exact = MODEL_PRICE_PER_MILLION[modelId];
  if (exact) return exact;
  const base = PRICE_MODEL_KEYS.find((key) => modelId.startsWith(`${key}-`));
  return base ? (MODEL_PRICE_PER_MILLION[base] || null) : null;
}

function safeJson(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : fallback;
  } catch { return fallback; }
}
function tokenCount(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function roundMoney(value: unknown): number { return Math.round(Number(value || 0) * 1_000_000) / 1_000_000; }
function roundRate(value: unknown): number { return Math.round(Number(value || 0) * 10_000) / 10_000; }

function monthToDateCutoff(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function emptyByModel(): AlfredUsageModelSummary {
  return { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

type UsageRow = {
  created_at?: string | null;
  event_type?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  metadata_json?: string | null;
};

type MutableUsageSummary = Omit<AlfredUsageStats, "comparisonWindows"> & {
  comparisonWindows?: AlfredUsageStats["comparisonWindows"];
};

export interface AlfredUsageStatsDb {
  execute(statement: InStatement): Promise<{ rows: object[] }>;
}

function summarizeRows(rows: UsageRow[], { windowDays, windowLabel, cutoff, now }: {
  windowDays: number | null;
  windowLabel: string;
  cutoff: Date;
  now: Date;
}): MutableUsageSummary {
  const cutoffMs = cutoff.getTime();
  const summary: MutableUsageSummary = {
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

  const conversationIds = new Set<string>();
  const toolMap = new Map<string, { name: string; calls: number; errors: number; totalDurationMs: number }>();

  for (const row of rows) {
    const at = Date.parse(row.created_at || "");
    if (!Number.isFinite(at) || at < cutoffMs) continue;
    if (row.created_at && (!summary.lastUsedAt || row.created_at > summary.lastUsedAt)) {
      summary.lastUsedAt = row.created_at;
    }

    if (row.event_type === "alfred_run_turn") {
      const meta = safeJson(row.metadata_json);
      if (meta.conversation_id) conversationIds.add(String(meta.conversation_id));
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

      const model = String(row.model || "unknown");
      if (!summary.byModel[model]) summary.byModel[model] = emptyByModel();
      const m = summary.byModel[model];
      if (!m) continue;
      m.calls += 1;
      m.inputTokens += input;
      m.cachedInputTokens += cached;
      m.outputTokens += output;
      m.estimatedCostUsd += cost;
    } else if (row.event_type === "alfred_tool_call") {
      const meta = safeJson(row.metadata_json);
      const name = String(meta.tool || "unknown");
      if (!toolMap.has(name)) toolMap.set(name, { name, calls: 0, errors: 0, totalDurationMs: 0 });
      const entry = toolMap.get(name);
      if (!entry) continue;
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
  for (const m of Object.values(summary.byModel)) {
    if (m) m.estimatedCostUsd = roundMoney(m.estimatedCostUsd);
  }

  const byTool: AlfredUsageToolSummary[] = [...toolMap.values()].map((t) => ({
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

function compactWindow(summary: MutableUsageSummary): AlfredUsageWindow {
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

export async function getAlfredUsageStats(userId: string, {
  dbClient = db,
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
}: { dbClient?: AlfredUsageStatsDb; windowDays?: number; now?: Date } = {}): Promise<AlfredUsageStats> {
  const windowCutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const monthCutoff = monthToDateCutoff(now);
  const queryCutoff = new Date(Math.min(windowCutoff.getTime(), monthCutoff.getTime()));

  let rows: UsageRow[] = [];
  try {
    const result = await dbClient.execute({
      sql: `SELECT created_at, event_type, model, input_tokens, cached_input_tokens,
                   output_tokens, metadata_json
            FROM ea_alfred_usage
            WHERE user_id = ? AND created_at >= ?`,
      args: [userId, queryCutoff.toISOString()],
    });
    rows = (result.rows || []) as UsageRow[];
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : "")) throw err;
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
  return summary as AlfredUsageStats;
}
