import type { AiUsageCategory, AiUsageTotals, EmailAiUsageStats } from "../../shared/types/ai-usage.ts";
import type { TriageCacheStatsResponse } from "../../shared/types/settings.ts";

const empty: AiUsageTotals = {
  calls: 0, failures: 0, pendingCalls: 0,
  inputTokens: null, outputTokens: null, cachedInputTokens: null,
  cacheCreationInputTokens: null, estimatedCostUsd: null,
  missingUsageCalls: 0, unpricedCalls: 0,
  totalProviderLatencyMs: null, averageProviderLatencyMs: null,
};

const cheap: AiUsageTotals = {
  ...empty, calls: 20, inputTokens: 28000, outputTokens: 1600,
  cachedInputTokens: 18000, cacheCreationInputTokens: 0,
  estimatedCostUsd: 0.012, totalProviderLatencyMs: 16000, averageProviderLatencyMs: 800,
};
const strong: AiUsageTotals = {
  ...empty, calls: 4, inputTokens: 8000, outputTokens: 700,
  cachedInputTokens: 4000, cacheCreationInputTokens: 1000,
  estimatedCostUsd: 0.038, totalProviderLatencyMs: 7600, averageProviderLatencyMs: 1900,
};
const extraction: AiUsageTotals = {
  ...empty, calls: 3, failures: 1, missingUsageCalls: 1, unpricedCalls: 1,
  inputTokens: 2400, outputTokens: 240, cachedInputTokens: 1000,
  cacheCreationInputTokens: 0, estimatedCostUsd: 0.004,
  totalProviderLatencyMs: 3000, averageProviderLatencyMs: 1000,
};
const verification: AiUsageTotals = {
  ...empty, calls: 1, pendingCalls: 1, inputTokens: 600, outputTokens: 60,
  cachedInputTokens: 400, cacheCreationInputTokens: 0, estimatedCostUsd: 0.002,
  totalProviderLatencyMs: 1200, averageProviderLatencyMs: 1200,
};
const matching: AiUsageTotals = {
  ...empty, calls: 2, inputTokens: 1000, outputTokens: 80,
  cachedInputTokens: 400, cacheCreationInputTokens: 0, estimatedCostUsd: 0.002,
  totalProviderLatencyMs: 1600, averageProviderLatencyMs: 800,
};
const noCalls: AiUsageCategory = { ...empty, byPurpose: {}, models: [] };

// Fictional, in-memory samples only. The UI labels this data as demo usage.
export function demoEmailAiUsageStats(): EmailAiUsageStats {
  const now = new Date();
  return {
    generatedAt: now.toISOString(), windowDays: 7,
    ledgerStartedAt: new Date(now.getTime() - 7 * 86400000).toISOString(),
    contexts: {
      production: {
        triage: {
          ...empty, calls: 24, inputTokens: 36000, outputTokens: 2300,
          cachedInputTokens: 22000, cacheCreationInputTokens: 1000,
          estimatedCostUsd: 0.05, totalProviderLatencyMs: 23600, averageProviderLatencyMs: 23600 / 24,
          byPurpose: { triage_cheap: cheap, triage_strong: strong }, models: ["demo-cheap-model", "demo-strong-model"],
        },
        financialEmail: {
          ...empty, calls: 6, failures: 1, pendingCalls: 1, missingUsageCalls: 1, unpricedCalls: 1,
          inputTokens: 4000, outputTokens: 380, cachedInputTokens: 1800, cacheCreationInputTokens: 0,
          estimatedCostUsd: 0.008, totalProviderLatencyMs: 5800, averageProviderLatencyMs: 5800 / 6,
          byPurpose: { extraction, verification, matching }, models: ["demo-financial-model"],
        },
      },
      evaluation: { triage: structuredClone(noCalls), financialEmail: structuredClone(noCalls) },
    },
  };
}

export function demoLegacyTriageStats(): TriageCacheStatsResponse {
  const tier = { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0 };
  const window = {
    windowDays: 7, windowLabel: "Legacy snapshot", openaiCalls: 0,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
    estimatedSavingsUsd: 0, hitRate: 0, models: [], byTier: { cheap: tier, strong: tier },
  };
  return { ...window, generatedAt: new Date().toISOString(), lastTriagedAt: null, comparisonWindows: { monthToDate: window } };
}
