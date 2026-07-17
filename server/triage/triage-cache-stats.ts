import db from "../db/connection.ts";
import type {
  TriageCacheStatsResponse,
  TriageCacheStatsWindow,
  TriageCacheTierStats,
} from "../../shared/types/settings.ts";
import type { TriageDb } from "./triage-types.ts";

const DEFAULT_WINDOW_DAYS = 7;
const OPENAI_PRICE_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.4": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, cachedInput: 0.02, output: 1.25 },
};
const OPENAI_PRICE_MODEL_KEYS = Object.keys(OPENAI_PRICE_PER_MILLION)
  .sort((left, right) => right.length - left.length);

interface TriageCacheRow extends Record<string, unknown> {
  last_triaged_at?: string | null;
  model_usage_json?: string | null;
  cheap_model_result_json?: string | null;
  strong_model_result_json?: string | null;
}

interface OpenAIModelResult extends Record<string, unknown> {
  provider: "openai";
  model?: string;
  usage?: TriageUsage;
}

interface TriageUsage extends Record<string, unknown> {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
}

interface TriageCacheCall {
  tier: "cheap" | "strong";
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  lastTriagedAt: string | null;
}

type MutableSummary = Omit<TriageCacheStatsResponse, "comparisonWindows">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJson(value: unknown, fallback: unknown = null): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return fallback;
  }
}

function tokenCount(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cachedInputTokens(usage: TriageUsage = {}): number {
  return tokenCount(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens,
  );
}

function emptyTierStats(): TriageCacheTierStats {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
  };
}

function roundMoney(value: unknown): number {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function roundRate(value: unknown): number {
  return Math.round(Number(value || 0) * 10_000) / 10_000;
}

function openAIModelResult(row: TriageCacheRow, tier: "cheap" | "strong"): OpenAIModelResult | null {
  const raw = tier === "cheap" ? row.cheap_model_result_json : row.strong_model_result_json;
  const result = safeJson(raw);
  return isRecord(result) && result.provider === "openai" ? result as OpenAIModelResult : null;
}

function priceForOpenAIModel(model: unknown): { input: number; cachedInput: number; output: number } | null {
  const modelId = String(model || "");
  const exact = OPENAI_PRICE_PER_MILLION[modelId];
  if (exact) return exact;
  const baseModel = OPENAI_PRICE_MODEL_KEYS.find((key) => modelId.startsWith(`${key}-`));
  return baseModel ? OPENAI_PRICE_PER_MILLION[baseModel] || null : null;
}

function collectTier(row: TriageCacheRow, tier: "cheap" | "strong"): TriageCacheCall | null {
  const result = openAIModelResult(row, tier);
  if (!result) return null;
  const model = result.model || "";
  const parsedUsage = safeJson(row.model_usage_json, {});
  const tierUsage = isRecord(parsedUsage) && isRecord(parsedUsage[tier])
    ? parsedUsage[tier] as TriageUsage
    : null;
  const usage = tierUsage || result.usage || {};
  return {
    tier,
    model,
    inputTokens: tokenCount(usage.input_tokens),
    cachedInputTokens: cachedInputTokens(usage),
    outputTokens: tokenCount(usage.output_tokens),
    lastTriagedAt: row.last_triaged_at || null,
  };
}

function addCall(summary: MutableSummary, models: Set<string>, call: TriageCacheCall): void {
  const tierStats = summary.byTier[call.tier];
  const price = priceForOpenAIModel(call.model);
  const uncachedInputTokens = Math.max(0, call.inputTokens - call.cachedInputTokens);
  const estimatedCost = price
    ? ((uncachedInputTokens / 1_000_000) * price.input)
      + ((call.cachedInputTokens / 1_000_000) * price.cachedInput)
      + ((call.outputTokens / 1_000_000) * price.output)
    : 0;
  const savings = price
    ? (call.cachedInputTokens / 1_000_000) * (price.input - price.cachedInput)
    : 0;

  summary.openaiCalls += 1;
  summary.inputTokens += call.inputTokens;
  summary.cachedInputTokens += call.cachedInputTokens;
  summary.outputTokens += call.outputTokens;
  summary.estimatedCostUsd += estimatedCost;
  summary.estimatedSavingsUsd += savings;
  models.add(call.model);
  if (call.lastTriagedAt && (!summary.lastTriagedAt || call.lastTriagedAt > summary.lastTriagedAt)) {
    summary.lastTriagedAt = call.lastTriagedAt;
  }

  tierStats.calls += 1;
  tierStats.inputTokens += call.inputTokens;
  tierStats.cachedInputTokens += call.cachedInputTokens;
  tierStats.outputTokens += call.outputTokens;
  tierStats.estimatedCostUsd += estimatedCost;
  tierStats.estimatedSavingsUsd += savings;
}

function monthToDateCutoff(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function summarizeRows(rows: TriageCacheRow[], {
  windowDays,
  windowLabel = null,
  cutoff,
  now,
}: { windowDays: number | null; windowLabel?: string | null; cutoff: Date; now: Date }): MutableSummary {
  const cutoffMs = cutoff.getTime();
  const filteredRows = rows.filter((row) => {
    const triagedAt = Date.parse(row.last_triaged_at || "");
    return Number.isFinite(triagedAt) && triagedAt >= cutoffMs;
  });

  const models = new Set<string>();
  const summary: MutableSummary = {
    windowDays,
    windowLabel,
    generatedAt: now.toISOString(),
    openaiCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
    hitRate: 0,
    lastTriagedAt: null,
    models: [],
    byTier: {
      cheap: emptyTierStats(),
      strong: emptyTierStats(),
    },
  };

  for (const row of filteredRows) {
    for (const tier of ["cheap", "strong"] as const) {
      const call = collectTier(row, tier);
      if (call) addCall(summary, models, call);
    }
  }

  summary.hitRate = summary.inputTokens
    ? roundRate(summary.cachedInputTokens / summary.inputTokens)
    : 0;
  summary.estimatedCostUsd = roundMoney(summary.estimatedCostUsd);
  summary.estimatedSavingsUsd = roundMoney(summary.estimatedSavingsUsd);
  summary.byTier.cheap.estimatedCostUsd = roundMoney(summary.byTier.cheap.estimatedCostUsd);
  summary.byTier.cheap.estimatedSavingsUsd = roundMoney(summary.byTier.cheap.estimatedSavingsUsd);
  summary.byTier.strong.estimatedCostUsd = roundMoney(summary.byTier.strong.estimatedCostUsd);
  summary.byTier.strong.estimatedSavingsUsd = roundMoney(summary.byTier.strong.estimatedSavingsUsd);
  summary.models = [...models].filter(Boolean).sort();

  return summary;
}

function compactComparisonWindow(summary: MutableSummary): TriageCacheStatsWindow {
  return {
    windowDays: summary.windowDays,
    windowLabel: summary.windowLabel,
    openaiCalls: summary.openaiCalls,
    inputTokens: summary.inputTokens,
    cachedInputTokens: summary.cachedInputTokens,
    outputTokens: summary.outputTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
    estimatedSavingsUsd: summary.estimatedSavingsUsd,
    hitRate: summary.hitRate,
  };
}

export async function getTriageCacheStats(userId: string, {
  dbClient = db as unknown as TriageDb,
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
}: { dbClient?: TriageDb; windowDays?: number; now?: Date } = {}): Promise<TriageCacheStatsResponse> {
  const windowCutoff = new Date(now.getTime() - (windowDays * 24 * 60 * 60 * 1000));
  const monthCutoff = monthToDateCutoff(now);
  const queryCutoff = new Date(Math.min(windowCutoff.getTime(), monthCutoff.getTime()));
  const result = await dbClient.execute({
    sql: `SELECT last_triaged_at, model_usage_json,
                 cheap_model_result_json, strong_model_result_json
          FROM ea_email_triage
          WHERE user_id = ?
            AND last_triaged_at >= ?
            AND model_usage_json IS NOT NULL
            AND model_usage_json != '{}'`,
    args: [userId, queryCutoff.toISOString()],
  });

  const summary = summarizeRows(result.rows as TriageCacheRow[], {
    windowDays,
    windowLabel: "rolling",
    cutoff: windowCutoff,
    now,
  });
  const monthToDateSummary = summarizeRows(result.rows as TriageCacheRow[], {
    windowDays: null,
    windowLabel: "month_to_date",
    cutoff: monthCutoff,
    now,
  });
  return {
    ...summary,
    comparisonWindows: {
      monthToDate: compactComparisonWindow(monthToDateSummary),
    },
  };
}
