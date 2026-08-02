import type { ProviderModelAvailability, ProviderModelOption } from "../shared/types/settings.ts";
import {
  getAiCredentialMetadata,
  resolveAiApiKey,
  type AiProvider,
} from "./ai-credentials.ts";
import { fetchWithTimeout, type FetchFunction } from "./platform/fetch-with-timeout.ts";
import type { InstanceCredentialMetadata } from "../shared/types/instance-credentials.ts";

export type AiModelUseCase = "email_triage" | "bill_extraction" | "alfred";

type ProviderDefaults = Record<AiModelUseCase, string>;

interface ProviderDefinition {
  provider: AiProvider;
  label: string;
  envVar: string;
  pricingUrl: string;
  defaults: ProviderDefaults;
}

interface AnthropicModelResponse {
  data?: unknown;
}

interface AnthropicCacheEntry {
  credentialVersion: number | null;
  fetchedAt: number;
  models: ProviderModelOption[];
}

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const ANTHROPIC_DISCOVERY_TIMEOUT_MS = 10_000;
export const AI_MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

const PROVIDERS: Record<AiProvider, ProviderDefinition> = {
  anthropic: {
    provider: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    defaults: {
      email_triage: "claude-sonnet-4-6",
      bill_extraction: "claude-haiku-4-5",
      alfred: "claude-sonnet-4-6",
    },
  },
  openai: {
    provider: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    defaults: {
      email_triage: "gpt-5.5",
      bill_extraction: "gpt-5.5",
      alfred: "gpt-5.6-sol",
    },
  },
};

export const OPENAI_MODELS: readonly ProviderModelOption[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { id: "gpt-5.4-pro", label: "GPT-5.4 Pro" },
];

// Alfred requires SSE streaming for its visible text/tool trail. GPT-5.5 Pro is
// valid for non-streaming Responses workloads but does not support streaming.
const OPENAI_ALFRED_MODELS = OPENAI_MODELS.filter(({ id }) => id !== "gpt-5.5-pro");

function openAiModelsForUseCase(useCase: AiModelUseCase): readonly ProviderModelOption[] {
  return useCase === "alfred" ? OPENAI_ALFRED_MODELS : OPENAI_MODELS;
}

export const ANTHROPIC_FALLBACK_MODELS: readonly ProviderModelOption[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProvider(value: unknown): value is AiProvider {
  return value === "openai" || value === "anthropic";
}

function isSafeAnthropicModelId(value: unknown): value is string {
  return typeof value === "string"
    && /^claude-[a-z0-9][a-z0-9._-]{1,119}$/i.test(value);
}

function isSafeOpenAiModelId(value: unknown): value is string {
  return typeof value === "string"
    && /^gpt-[a-z0-9][a-z0-9._-]{1,119}$/i.test(value);
}

function normalizeAnthropicModels(payload: unknown): ProviderModelOption[] {
  if (!isRecord(payload) || !Array.isArray((payload as AnthropicModelResponse).data)) {
    throw new Error("Anthropic model catalog response is invalid");
  }

  const seen = new Set<string>();
  const models: ProviderModelOption[] = [];
  for (const item of (payload as AnthropicModelResponse).data as unknown[]) {
    if (!isRecord(item) || !isSafeAnthropicModelId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    models.push({
      id: item.id,
      label: typeof item.display_name === "string" && item.display_name.trim()
        ? item.display_name.trim()
        : item.id,
    });
  }

  if (!models.length) {
    throw new Error("Anthropic model catalog response contained no Claude models");
  }
  return models;
}

export function getDefaultAiModel(provider: AiProvider, useCase: AiModelUseCase): string {
  return PROVIDERS[provider].defaults[useCase];
}

export function inferAiProviderFromModel(model: unknown): AiProvider | null {
  if (isSafeOpenAiModelId(model)) return "openai";
  if (isSafeAnthropicModelId(model)) return "anthropic";
  return null;
}

export function isSafeStoredAiModel(provider: unknown, model: unknown): boolean {
  if (provider === "openai") return isSafeOpenAiModelId(model);
  if (provider === "anthropic") return isSafeAnthropicModelId(model);
  return false;
}

export function isSelectableAiModel(
  provider: unknown,
  model: unknown,
  _useCase: AiModelUseCase,
): boolean {
  if (provider === "openai") {
    return openAiModelsForUseCase(_useCase).some((entry) => entry.id === model);
  }
  return provider === "anthropic" && isSafeAnthropicModelId(model);
}

export function resolveStoredAiModelConfig({
  provider,
  model,
  useCase,
  defaultProvider = "anthropic",
}: {
  provider?: unknown;
  model?: unknown;
  useCase: AiModelUseCase;
  defaultProvider?: AiProvider;
}): { provider: AiProvider; model: string } {
  const rawModel = typeof model === "string" && model ? model : null;
  const resolvedProvider = isProvider(provider)
    ? provider
    : inferAiProviderFromModel(rawModel) || defaultProvider;

  return {
    provider: resolvedProvider,
    model: rawModel && isSafeStoredAiModel(resolvedProvider, rawModel)
      ? rawModel
      : getDefaultAiModel(resolvedProvider, useCase),
  };
}

export function createAiModelCatalogService({
  fetchImpl = globalThis.fetch as FetchFunction<Response>,
  getCredentialMetadata = (provider) => getAiCredentialMetadata(provider),
  resolveApiKey = (provider) => resolveAiApiKey(provider),
  now = Date.now,
  ttlMs = AI_MODEL_CATALOG_TTL_MS,
}: {
  fetchImpl?: FetchFunction<Response>;
  getCredentialMetadata?: (provider: AiProvider) => Promise<InstanceCredentialMetadata>;
  resolveApiKey?: (provider: AiProvider) => Promise<string | null>;
  now?: () => number;
  ttlMs?: number;
} = {}) {
  let anthropicCache: AnthropicCacheEntry | null = null;
  let anthropicRefresh: Promise<ProviderModelOption[]> | null = null;

  async function fetchAnthropicModels(
    credentialVersion: number | null,
  ): Promise<ProviderModelOption[]> {
    const currentTime = now();
    if (
      anthropicCache
      && anthropicCache.credentialVersion === credentialVersion
      && currentTime - anthropicCache.fetchedAt < ttlMs
    ) {
      return anthropicCache.models;
    }
    if (anthropicRefresh) return anthropicRefresh;

    anthropicRefresh = (async () => {
      const apiKey = await resolveApiKey("anthropic");
      if (!apiKey) throw new Error("Anthropic credential is unavailable");

      const response = await fetchWithTimeout(ANTHROPIC_MODELS_URL, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      }, {
        timeoutMs: ANTHROPIC_DISCOVERY_TIMEOUT_MS,
        fetchFn: fetchImpl,
      });
      if (!response.ok) {
        throw new Error(`Anthropic model discovery failed (${response.status})`);
      }

      const models = normalizeAnthropicModels(await response.json());
      anthropicCache = {
        credentialVersion,
        fetchedAt: now(),
        models,
      };
      return models;
    })();

    try {
      return await anthropicRefresh;
    } catch {
      return anthropicCache?.models || [...ANTHROPIC_FALLBACK_MODELS];
    } finally {
      anthropicRefresh = null;
    }
  }

  async function availability(useCase: AiModelUseCase): Promise<ProviderModelAvailability[]> {
    const [anthropicMetadata, openAiMetadata] = await Promise.all([
      getCredentialMetadata("anthropic"),
      getCredentialMetadata("openai"),
    ]);
    const anthropicModels = anthropicMetadata.activeConfigured
      ? await fetchAnthropicModels(anthropicMetadata.version)
      : [...ANTHROPIC_FALLBACK_MODELS];

    return [
      {
        provider: PROVIDERS.anthropic.provider,
        label: PROVIDERS.anthropic.label,
        envVar: PROVIDERS.anthropic.envVar,
        pricingUrl: PROVIDERS.anthropic.pricingUrl,
        available: anthropicMetadata.activeConfigured,
        defaultModel: getDefaultAiModel("anthropic", useCase),
        models: anthropicModels,
      },
      {
        provider: PROVIDERS.openai.provider,
        label: PROVIDERS.openai.label,
        envVar: PROVIDERS.openai.envVar,
        pricingUrl: PROVIDERS.openai.pricingUrl,
        available: openAiMetadata.activeConfigured,
        defaultModel: getDefaultAiModel("openai", useCase),
        models: [...openAiModelsForUseCase(useCase)],
      },
    ];
  }

  return { availability };
}

export const aiModelCatalogService = createAiModelCatalogService();
