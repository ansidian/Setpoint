import type { AlfredUsageStats, AlfredUsageSummary } from '../../shared/types/alfred';

// Fictional recorded turns for inspecting the provider comparison. No model calls.
export function demoAlfredUsageStats(): AlfredUsageStats {
  const now = new Date().toISOString();
  function summary(model: string, input: number, cached: number, writes: number, cost: number, savings: number): AlfredUsageSummary {
    const window = {
      windowDays: 7, windowLabel: 'rolling', queries: 1, turns: 1,
      inputTokens: input, cachedInputTokens: cached, cacheCreationInputTokens: writes,
      outputTokens: 100, unpricedCalls: 0, estimatedCostUsd: cost, estimatedSavingsUsd: savings,
      cacheHitRate: cached / input,
    };
    return {
      ...window, generatedAt: now, lastUsedAt: now,
      byModel: { [model]: { calls: 1, inputTokens: input, cachedInputTokens: cached, cacheCreationInputTokens: writes,
        outputTokens: 100, unpricedCalls: 0, estimatedCostUsd: cost } },
      tools: { totalCalls: 0, distinctTools: 0, byTool: [] },
      comparisonWindows: { monthToDate: { ...window, windowDays: null, windowLabel: 'month_to_date' } },
    };
  }
  const openai = summary('gpt-5.6-sol', 1000, 600, 300, 0.00414, 0.00186);
  const anthropic = summary('claude-haiku-4-5', 1000, 600, 300, 0.001035, 0.000465);
  const combined = {
    ...openai, queries: 2, turns: 2, inputTokens: 2000, cachedInputTokens: 1200, cacheCreationInputTokens: 600,
    outputTokens: 200, estimatedCostUsd: 0.005175, estimatedSavingsUsd: 0.002325,
    byModel: { ...openai.byModel, ...anthropic.byModel },
  };
  return {
    ...combined, byProvider: { openai, anthropic },
    comparisonWindows: { monthToDate: { ...combined, windowDays: null, windowLabel: 'month_to_date' } },
  };
}
