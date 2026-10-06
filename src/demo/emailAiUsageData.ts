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
  ...empty, calls: 4, failures: 1, inputTokens: 8000, outputTokens: 2300,
  cachedInputTokens: 4000, cacheCreationInputTokens: 1000,
  estimatedCostUsd: 0.038, totalProviderLatencyMs: 7600, averageProviderLatencyMs: 1900,
};
const noCalls: AiUsageCategory = { ...empty, byPurpose: {}, models: [], recentFailures: [] };

// Fictional, in-memory samples only. The UI labels this data as demo usage.
export function demoEmailAiUsageStats(): EmailAiUsageStats {
  const now = new Date();
  const stats: EmailAiUsageStats = {
    byProvider: {
      openai: { production: { triage: structuredClone(noCalls) }, evaluation: { triage: structuredClone(noCalls) } },
      anthropic: { production: { triage: structuredClone(noCalls) }, evaluation: { triage: structuredClone(noCalls) } },
    },
    generatedAt: now.toISOString(), windowDays: 7,
    ledgerStartedAt: new Date(now.getTime() - 7 * 86400000).toISOString(),
    contexts: {
      production: {
        triage: {
          ...empty, calls: 24, failures: 1, inputTokens: 36000, outputTokens: 3900,
          cachedInputTokens: 22000, cacheCreationInputTokens: 1000,
          estimatedCostUsd: 0.05, totalProviderLatencyMs: 23600, averageProviderLatencyMs: 23600 / 24,
          recentFailures: [{
            eventId: "demo-triage-call", runId: "demo-triage-run", purpose: "triage_strong", origin: "background_triage",
            provider: "openai", model: "demo-strong-model", startedAt: new Date(now.getTime() - 3600000).toISOString(),
            providerLatencyMs: 2400, outcome: "parse_error", httpStatus: 200, inputTokens: 2000, outputTokens: 1600,
            diagnostics: { responseStatus: "incomplete", stopReason: "max_output_tokens", maxOutputTokens: 1600, reasoningTokens: 1200, failureCode: "output_limit" },
          }],
          byPurpose: { triage_cheap: cheap, triage_strong: strong }, models: ["demo-cheap-model", "demo-strong-model"],
        },
      },
      evaluation: { triage: structuredClone(noCalls) },
    },
  };
  stats.byProvider.openai.production.triage = structuredClone(stats.contexts.production.triage);
  return stats;
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
