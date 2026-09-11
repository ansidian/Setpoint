import db from "../db/connection.ts";
import { calculateAlfredUsage } from "./alfred-usage.ts";
import type { InStatement } from "@libsql/client";
import type {
  AlfredUsageModelSummary,
  AlfredUsageStats,
  AlfredUsageSummary,
  AlfredUsageToolSummary,
  AlfredUsageWindow,
} from "../../shared/types/alfred.ts";

const DEFAULT_WINDOW_DAYS = 7;

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
  return { calls: 0, inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unpricedCalls: 0 };
}

type UsageRow = {
  created_at?: string | null;
  event_type?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  metadata_json?: string | null;
};

type MutableUsageSummary = Omit<AlfredUsageSummary, "comparisonWindows"> & {
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
    cacheCreationInputTokens: 0,
    unpricedCalls: 0,
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
    if (!Number.isFinite(at) || at < cutoffMs || at > now.getTime()) continue;
    if (row.created_at && (!summary.lastUsedAt || row.created_at > summary.lastUsedAt)) {
      summary.lastUsedAt = row.created_at;
    }

    if (row.event_type === "alfred_run_turn") {
      const meta = safeJson(row.metadata_json);
      if (meta.conversation_id) conversationIds.add(String(meta.conversation_id));
      summary.turns += 1;
      // Old rows kept provider-shaped input counts. New rows retain normalized
      // usage and the price at recording time, so future rate edits cannot reprice them.
      const saved = meta.accounting as ReturnType<typeof calculateAlfredUsage> | undefined;
      const accounting = saved?.version === 1 ? saved : calculateAlfredUsage(String(row.model || ""), {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_input_tokens: row.cached_input_tokens,
        cache_creation_input_tokens: row.cache_creation_input_tokens ?? 0,
      }, meta.provider);
      const input = tokenCount(accounting.tokens.inputTokens);
      const cached = tokenCount(accounting.tokens.cachedInputTokens);
      const created = tokenCount(accounting.tokens.cacheCreationInputTokens);
      const output = tokenCount(accounting.tokens.outputTokens);
      summary.inputTokens += input;
      summary.cachedInputTokens += cached;
      summary.cacheCreationInputTokens += created;
      summary.outputTokens += output;
      const cost = accounting.estimatedCostUsd;
      const savings = accounting.estimatedSavingsUsd;
      if (cost === null) summary.unpricedCalls += 1;
      summary.estimatedCostUsd = (summary.estimatedCostUsd ?? 0) + (cost ?? 0);
      summary.estimatedSavingsUsd = (summary.estimatedSavingsUsd ?? 0) + (savings ?? 0);

      const model = String(row.model || "unknown");
      if (!summary.byModel[model]) summary.byModel[model] = emptyByModel();
      const m = summary.byModel[model];
      if (!m) continue;
      m.calls += 1;
      m.inputTokens += input;
      m.cachedInputTokens += cached;
      m.cacheCreationInputTokens += created;
      m.outputTokens += output;
      if (cost === null) m.unpricedCalls += 1;
      m.estimatedCostUsd = (m.estimatedCostUsd ?? 0) + (cost ?? 0);
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
  const allUnpriced = summary.turns > 0 && summary.unpricedCalls === summary.turns;
  summary.estimatedCostUsd = allUnpriced ? null : roundMoney(summary.estimatedCostUsd);
  summary.estimatedSavingsUsd = allUnpriced ? null : roundMoney(summary.estimatedSavingsUsd);
  for (const m of Object.values(summary.byModel)) {
    if (m) m.estimatedCostUsd = m.unpricedCalls === m.calls ? null : roundMoney(m.estimatedCostUsd);
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
    cacheCreationInputTokens: summary.cacheCreationInputTokens,
    unpricedCalls: summary.unpricedCalls,
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
                   cache_creation_input_tokens, output_tokens, metadata_json
            FROM ea_alfred_usage
            WHERE user_id = ? AND created_at >= ?`,
      args: [userId, queryCutoff.toISOString()],
    });
    rows = (result.rows || []) as UsageRow[];
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : "")) throw err;
  }

  function summarize(selectedRows: UsageRow[]): AlfredUsageSummary {
    const summary = summarizeRows(selectedRows, { windowDays, windowLabel: "rolling", cutoff: windowCutoff, now });
    const monthToDate = summarizeRows(selectedRows, { windowDays: null, windowLabel: "month_to_date", cutoff: monthCutoff, now });
    return { ...summary, comparisonWindows: { monthToDate: compactWindow(monthToDate) } };
  }
  function belongsTo(row: UsageRow, provider: "openai" | "anthropic"): boolean {
    const meta = safeJson(row.metadata_json);
    if (meta.provider === "openai" || meta.provider === "anthropic") return meta.provider === provider;
    return Boolean(row.model?.startsWith(provider === "openai" ? "gpt-" : "claude-"));
  }
  return {
    ...summarize(rows),
    byProvider: {
      openai: summarize(rows.filter((row) => belongsTo(row, "openai"))),
      anthropic: summarize(rows.filter((row) => belongsTo(row, "anthropic"))),
    },
  };
}
