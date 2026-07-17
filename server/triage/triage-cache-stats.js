import db from "../db/connection.ts";

const DEFAULT_WINDOW_DAYS = 7;
const OPENAI_PRICE_PER_MILLION = {
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.4": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, cachedInput: 0.02, output: 1.25 },
};
const OPENAI_PRICE_MODEL_KEYS = Object.keys(OPENAI_PRICE_PER_MILLION)
  .sort((left, right) => right.length - left.length);

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tokenCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cachedInputTokens(usage = {}) {
  return tokenCount(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens,
  );
}

function emptyTierStats() {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
  };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function roundRate(value) {
  return Math.round(Number(value || 0) * 10_000) / 10_000;
}

function openAIModelResult(row, tier) {
  const raw = tier === "cheap" ? row.cheap_model_result_json : row.strong_model_result_json;
  const result = safeJson(raw);
  return result?.provider === "openai" ? result : null;
}

function priceForOpenAIModel(model) {
  const modelId = String(model || "");
  const exact = OPENAI_PRICE_PER_MILLION[modelId];
  if (exact) return exact;
  const baseModel = OPENAI_PRICE_MODEL_KEYS.find((key) => modelId.startsWith(`${key}-`));
  return baseModel ? OPENAI_PRICE_PER_MILLION[baseModel] : null;
}

function collectTier(row, tier) {
  const result = openAIModelResult(row, tier);
  if (!result) return null;
  const model = result.model || "";
  const usage = safeJson(row.model_usage_json, {})?.[tier] || result.usage || {};
  return {
    tier,
    model,
    inputTokens: tokenCount(usage.input_tokens),
    cachedInputTokens: cachedInputTokens(usage),
    outputTokens: tokenCount(usage.output_tokens),
    lastTriagedAt: row.last_triaged_at || null,
  };
}

function addCall(summary, call) {
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
  summary.models.add(call.model);
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

function monthToDateCutoff(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function summarizeRows(rows, {
  windowDays,
  windowLabel = null,
  cutoff,
  now,
}) {
  const cutoffMs = cutoff.getTime();
  const filteredRows = rows.filter((row) => {
    const triagedAt = Date.parse(row.last_triaged_at || "");
    return Number.isFinite(triagedAt) && triagedAt >= cutoffMs;
  });

  const summary = {
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
    models: new Set(),
    byTier: {
      cheap: emptyTierStats(),
      strong: emptyTierStats(),
    },
  };

  for (const row of filteredRows) {
    for (const tier of ["cheap", "strong"]) {
      const call = collectTier(row, tier);
      if (call) addCall(summary, call);
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
  summary.models = [...summary.models].filter(Boolean).sort();

  return summary;
}

function compactComparisonWindow(summary) {
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

export async function getTriageCacheStats(userId, {
  dbClient = db,
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
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

  const summary = summarizeRows(result.rows, {
    windowDays,
    windowLabel: "rolling",
    cutoff: windowCutoff,
    now,
  });
  const monthToDateSummary = summarizeRows(result.rows, {
    windowDays: null,
    windowLabel: "month_to_date",
    cutoff: monthCutoff,
    now,
  });
  summary.comparisonWindows = {
    monthToDate: compactComparisonWindow(monthToDateSummary),
  };

  return summary;
}
