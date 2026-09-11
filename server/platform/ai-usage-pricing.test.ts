import { describe, expect, it } from 'vitest';
import { OPENAI_MODELS, ANTHROPIC_FALLBACK_MODELS } from '../ai-model-catalog.ts';
import { estimateAiUsageCost, normalizeAiUsage } from './ai-usage-tokens.ts';

// Official standard USD/1M input, cache-read, output prices checked 2026-09-10.
const prices = [
  ['openai', 'gpt-5.6-sol', 4, 0.4, 20],
  ['openai', 'gpt-5.6-terra', 2, 0.2, 12],
  ['openai', 'gpt-5.6-luna', 0.2, 0.02, 1.2],
  ['openai', 'gpt-5.5', 5, 0.5, 30],
  ['openai', 'gpt-5.5-pro', 30, 30, 180],
  ['openai', 'gpt-5.4', 2.5, 0.25, 15],
  ['openai', 'gpt-5.4-mini', 0.75, 0.075, 4.5],
  ['openai', 'gpt-5.4-nano', 0.2, 0.02, 1.25],
  ['openai', 'gpt-5.4-pro', 30, 30, 180],
  ['anthropic', 'claude-haiku-4-5', 1, 0.1, 5],
  ['anthropic', 'claude-sonnet-4-5', 3, 0.3, 15],
  ['anthropic', 'claude-sonnet-4-6', 3, 0.3, 15],
  ['anthropic', 'claude-opus-4-5', 5, 0.5, 25],
  ['anthropic', 'claude-opus-4-6', 5, 0.5, 25],
  ['anthropic', 'claude-opus-4-7', 5, 0.5, 25],
  ['anthropic', 'claude-opus-4-8', 5, 0.5, 25],
  ['anthropic', 'claude-opus-5', 5, 0.5, 25],
  ['anthropic', 'claude-sonnet-5', 2, 0.2, 10],
  ['anthropic', 'claude-fable-5', 10, 1, 50],
  ['anthropic', 'claude-mythos-5', 10, 1, 50],
  ['anthropic', 'claude-fable-5-1', 10, 0.25, 50],
  ['anthropic', 'claude-mythos-5-1', 10, 0.25, 50],
] as const;

describe('source-checked pricing', () => {
  it.each(prices)('prices %s %s input, cache reads, and output', (provider, model, input, cached, output) => {
    const tokens = normalizeAiUsage(provider, provider === 'openai'
      ? { input_tokens: 2000, output_tokens: 1000, input_tokens_details: { cached_tokens: 1000 } }
      : { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000 });
    const estimate = estimateAiUsageCost(provider, model, tokens);
    expect(estimate.estimatedCostUsd).toBeCloseTo((input + cached + output) / 1000, 10);
    expect(estimate.estimatedSavingsUsd).toBeCloseTo((input - cached) / 1000, 10);
    expect(estimate.pricingVersion).toBe('standard-text-2026-09-10');
  });

  it('has known standard pricing for every curated and fallback model', () => {
    for (const [provider, models] of [['openai', OPENAI_MODELS], ['anthropic', ANTHROPIC_FALLBACK_MODELS]] as const) {
      for (const { id } of models) {
        const tokens = normalizeAiUsage(provider, { input_tokens: 100, output_tokens: 10 });
        expect(estimateAiUsageCost(provider, id, tokens).estimatedCostUsd, id).not.toBeNull();
      }
    }
  });

  it('applies GPT-5.6 long-context premiums only above 272K total input', () => {
    for (const [input, expected] of [[272000, 1.108], [272001, 2.206008]] as const) {
      const tokens = normalizeAiUsage('openai', { input_tokens: input, output_tokens: 1000 });
      expect(estimateAiUsageCost('openai', 'gpt-5.6-sol', tokens).estimatedCostUsd).toBeCloseTo(expected, 10);
    }
  });

  it('retains standard Claude 4.6+ prices across the full context window', () => {
    const tokens = normalizeAiUsage('anthropic', { input_tokens: 900000, output_tokens: 1000 });
    expect(estimateAiUsageCost('anthropic', 'claude-sonnet-4-6', tokens).estimatedCostUsd).toBeCloseTo(2.715, 10);
    expect(estimateAiUsageCost('anthropic', 'claude-sonnet-4-5', tokens).estimatedCostUsd).toBeNull();
  });
});
