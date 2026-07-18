import { getAiCredentialMetadata } from "../ai-credentials.ts";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";

export type EmailAiProvider = "anthropic" | "openai";

export interface EmailAiModelEntry {
  id: string;
  label: string;
}

interface EmailAiProviderEntry {
  provider: EmailAiProvider;
  label: string;
  envVar: string;
  defaultModel: string;
  models: readonly EmailAiModelEntry[];
}

export const EMAIL_AI_MODEL_CATALOG: readonly EmailAiProviderEntry[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    models: [
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-sonnet-4-5-20250514", label: "Sonnet 4.5" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    ],
  },
];

export const DEFAULT_EMAIL_AI_PROVIDER: EmailAiProvider = "anthropic";
export const DEFAULT_EMAIL_AI_MODEL = "claude-sonnet-4-6";

export function inferEmailAiProviderFromModel(model: unknown): EmailAiProvider | null {
  if (!model) return null;
  if (String(model).startsWith("gpt-")) return "openai";
  if (String(model).startsWith("claude-")) return "anthropic";
  return null;
}

export function getDefaultEmailAiModel(provider: EmailAiProvider = DEFAULT_EMAIL_AI_PROVIDER): string {
  return EMAIL_AI_MODEL_CATALOG.find((entry) => entry.provider === provider)?.defaultModel || DEFAULT_EMAIL_AI_MODEL;
}

export function isAllowedEmailAiModel(provider: string, model: unknown): boolean {
  const entry = EMAIL_AI_MODEL_CATALOG.find((p) => p.provider === provider);
  if (!entry) return false;
  return entry.models.some((m) => m.id === model);
}

export function resolveEmailAiModelConfig({
  provider,
  model,
}: { provider?: unknown; model?: unknown } = {}): { provider: EmailAiProvider; model: string } {
  const rawModel = typeof model === "string" && model ? model : null;
  const requestedProvider = provider === "anthropic" || provider === "openai" ? provider : null;
  const resolvedProvider = requestedProvider
    || inferEmailAiProviderFromModel(rawModel)
    || DEFAULT_EMAIL_AI_PROVIDER;
  const fallbackModel = getDefaultEmailAiModel(resolvedProvider);
  const resolvedModel = rawModel && isAllowedEmailAiModel(resolvedProvider, rawModel)
    ? rawModel
    : fallbackModel;

  return {
    provider: resolvedProvider,
    model: resolvedModel,
  };
}

export async function emailAiModelAvailability(
  credentials?: Pick<InstanceCredentialService, "getCredentialMetadata">,
) {
  return Promise.all(EMAIL_AI_MODEL_CATALOG.map(async (entry) => ({
    provider: entry.provider,
    label: entry.label,
    envVar: entry.envVar,
    available: (await getAiCredentialMetadata(entry.provider, credentials)).activeConfigured,
    defaultModel: entry.defaultModel,
    models: [...entry.models],
  })));
}
