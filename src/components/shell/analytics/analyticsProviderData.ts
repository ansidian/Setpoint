import type { AlfredUsageStats } from '../../../../shared/types/alfred';
import type { EmailAiUsageStats } from '../../../../shared/types/ai-usage';
import type { EmailSearchCostStats } from '../../../../shared/types/email';

export type AnalyticsTabKey = 'alfred' | 'search' | 'triage' | 'financial';
export type AnalyticsProvider = 'all' | 'openai' | 'anthropic';
export type ProviderComparison = Record<'openai' | 'anthropic', {
  calls: number;
  cost: number | null;
  unpricedCalls: number;
}>;

export function providerComparison(tab: AnalyticsTabKey, data: unknown): ProviderComparison | null {
  if (!data) return null;
  if (tab === 'search') {
    const stats = data as EmailSearchCostStats;
    const corpus = stats.corpusEmbeddings?.actualUsage;
    const query = stats.querySearch?.actualUsage;
    if (!corpus || !query) return null;
    return {
      openai: { calls: corpus.calls + query.calls, cost: corpus.estimatedCostUsd + query.estimatedCostUsd, unpricedCalls: 0 },
      anthropic: { calls: 0, cost: 0, unpricedCalls: 0 },
    };
  }
  const entries = (['openai', 'anthropic'] as const).map((provider) => {
    if (tab === 'alfred') {
      const stats = (data as AlfredUsageStats).byProvider?.[provider];
      return stats ? { calls: stats.turns, cost: stats.estimatedCostUsd, unpricedCalls: stats.unpricedCalls } : null;
    }
    const stats = (data as EmailAiUsageStats).byProvider?.[provider].production[tab === 'triage' ? 'triage' : 'financialEmail'];
    return stats ? { calls: stats.calls, cost: stats.estimatedCostUsd, unpricedCalls: stats.unpricedCalls } : null;
  });
  return entries[0] && entries[1] ? { openai: entries[0], anthropic: entries[1] } : null;
}

export function selectProviderStats(tab: AnalyticsTabKey, data: unknown, provider: AnalyticsProvider): unknown {
  if (!data || provider === 'all' || tab === 'search') return data;
  if (tab === 'alfred') return (data as AlfredUsageStats).byProvider?.[provider];
  const stats = data as EmailAiUsageStats;
  const contexts = stats.byProvider?.[provider];
  return contexts ? { ...stats, contexts } : null;
}
