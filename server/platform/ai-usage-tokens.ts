export interface AiUsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalCount(value: unknown, hasUsage: boolean): number | null {
  return value === undefined ? (hasUsage ? 0 : null) : count(value);
}

export function normalizeAiUsage(provider: "openai" | "anthropic", raw: unknown): AiUsageTokens {
  const usage = record(raw);
  const input = count(usage.input_tokens ?? usage.prompt_tokens);
  const output = count(usage.output_tokens ?? usage.completion_tokens);
  const hasUsage = input !== null && output !== null;
  if (provider === "openai") {
    const rawDetails = usage.input_tokens_details !== undefined ? usage.input_tokens_details : usage.prompt_tokens_details;
    const invalidDetails = rawDetails !== undefined && !isRecord(rawDetails);
    const details = record(rawDetails);
    const cached = invalidDetails ? null : optionalCount(details.cached_tokens, hasUsage);
    const created = invalidDetails ? null : optionalCount(details.cache_write_tokens, hasUsage);
    return {
      inputTokens: input, outputTokens: output,
      cachedInputTokens: cached !== null && input !== null && cached > input ? null : cached,
      cacheCreationInputTokens: created,
      cacheCreation5mTokens: hasUsage ? 0 : null,
      cacheCreation1hTokens: hasUsage ? 0 : null,
    };
  }
  // Anthropic input_tokens excludes both cache reads and cache writes. Normalize
  // to total input so a cross-provider total never drops cached prompt tokens.
  const cached = optionalCount(usage.cache_read_input_tokens, hasUsage);
  const created = optionalCount(usage.cache_creation_input_tokens, hasUsage);
  const creation = record(usage.cache_creation);
  const hasTtl = usage.cache_creation !== undefined;
  const oneHour = count(creation.ephemeral_1h_input_tokens) ?? (hasUsage && !hasTtl ? 0 : null);
  const fiveMin = count(creation.ephemeral_5m_input_tokens) ?? (hasUsage && !hasTtl ? created : null);
  return {
    inputTokens: input !== null && cached !== null && created !== null ? input + cached + created : null,
    outputTokens: output, cachedInputTokens: cached, cacheCreationInputTokens: created,
    cacheCreation5mTokens: fiveMin, cacheCreation1hTokens: oneHour,
  };
}

// Standard text API prices, USD / 1M tokens, checked 2026-09-03.
// https://developers.openai.com/api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
// Deliberately do not prefix-match arbitrary variants (e.g. -pro). Unknown
// models, nonstandard service tiers, and unsupported long contexts stay unpriced.
const PRICING_VERSION = "standard-text-2026-09-03";
type Price = { input: number; cached: number; output: number };
const OPENAI: Record<string, Price> = {
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
};
const ANTHROPIC: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, cached: 0.1, output: 5 },
  "claude-sonnet-4-5": { input: 3, cached: 0.3, output: 15 },
  "claude-sonnet-4-6": { input: 3, cached: 0.3, output: 15 },
  "claude-opus-4-5": { input: 5, cached: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cached: 0.5, output: 25 },
};

export function estimateAiUsageCost(provider: "openai" | "anthropic", model: string, tokens: AiUsageTokens, serviceTier?: unknown): {
  estimatedCostUsd: number | null; pricingVersion: string | null;
} {
  const unknown = { estimatedCostUsd: null, pricingVersion: null };
  if (serviceTier && serviceTier !== "default" && serviceTier !== "standard") return unknown;
  const base = model.replace(provider === "openai" ? /-\d{4}-\d{2}-\d{2}$/ : /-\d{8}$/, "");
  const price = (provider === "openai" ? OPENAI : ANTHROPIC)[base];
  const { inputTokens: input, outputTokens: output, cachedInputTokens: cached,
    cacheCreationInputTokens: created, cacheCreation5mTokens: fiveMin, cacheCreation1hTokens: oneHour } = tokens;
  if (!price || input === null || output === null || cached === null || created === null
    || fiveMin === null || oneHour === null || input > 200_000
    || cached + created > input) return unknown;
  if (provider === "anthropic" && fiveMin + oneHour !== created) return unknown;
  if (provider === "openai" && created > 0 && !base.startsWith("gpt-5.6-")) return unknown;
  const writesCost = provider === "openai" ? created * price.input * 1.25
    : fiveMin * price.input * 1.25 + oneHour * price.input * 2;
  const cost = ((input - cached - created) * price.input + cached * price.cached
    + writesCost + output * price.output) / 1_000_000;
  return { estimatedCostUsd: cost, pricingVersion: PRICING_VERSION };
}
