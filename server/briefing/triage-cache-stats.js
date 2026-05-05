import db from "../db/connection.js";

const DEFAULT_WINDOW_DAYS = 7;
const OPENAI_PRICE_PER_MILLION = {
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.4": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, cachedInput: 0.02, output: 1.25 },
};

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
  const price = OPENAI_PRICE_PER_MILLION[call.model] || null;
  const savings = price
    ? (call.cachedInputTokens / 1_000_000) * (price.input - price.cachedInput)
    : 0;

  summary.openaiCalls += 1;
  summary.inputTokens += call.inputTokens;
  summary.cachedInputTokens += call.cachedInputTokens;
  summary.outputTokens += call.outputTokens;
  summary.estimatedSavingsUsd += savings;
  summary.models.add(call.model);
  if (call.lastTriagedAt && (!summary.lastTriagedAt || call.lastTriagedAt > summary.lastTriagedAt)) {
    summary.lastTriagedAt = call.lastTriagedAt;
  }

  tierStats.calls += 1;
  tierStats.inputTokens += call.inputTokens;
  tierStats.cachedInputTokens += call.cachedInputTokens;
  tierStats.outputTokens += call.outputTokens;
  tierStats.estimatedSavingsUsd += savings;
}

export async function getTriageCacheStats(userId, {
  dbClient = db,
  windowDays = DEFAULT_WINDOW_DAYS,
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT last_triaged_at, model_usage_json,
                 cheap_model_result_json, strong_model_result_json
          FROM ea_email_triage
          WHERE user_id = ?
            AND last_triaged_at >= datetime('now', ?)
            AND model_usage_json IS NOT NULL
            AND model_usage_json != '{}'`,
    args: [userId, `-${windowDays} days`],
  });

  const summary = {
    windowDays,
    generatedAt: new Date().toISOString(),
    openaiCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedSavingsUsd: 0,
    hitRate: 0,
    lastTriagedAt: null,
    models: new Set(),
    byTier: {
      cheap: emptyTierStats(),
      strong: emptyTierStats(),
    },
  };

  for (const row of result.rows) {
    for (const tier of ["cheap", "strong"]) {
      const call = collectTier(row, tier);
      if (call) addCall(summary, call);
    }
  }

  summary.hitRate = summary.inputTokens
    ? roundRate(summary.cachedInputTokens / summary.inputTokens)
    : 0;
  summary.estimatedSavingsUsd = roundMoney(summary.estimatedSavingsUsd);
  summary.byTier.cheap.estimatedSavingsUsd = roundMoney(summary.byTier.cheap.estimatedSavingsUsd);
  summary.byTier.strong.estimatedSavingsUsd = roundMoney(summary.byTier.strong.estimatedSavingsUsd);
  summary.models = [...summary.models].filter(Boolean).sort();

  return summary;
}
