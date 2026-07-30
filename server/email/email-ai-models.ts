import {
  aiModelCatalogService,
  inferAiProviderFromModel,
  isSelectableAiModel,
  resolveStoredAiModelConfig,
} from "../ai-model-catalog.ts";
import type { AiProvider } from "../ai-credentials.ts";

export type EmailAiProvider = AiProvider;

export const DEFAULT_EMAIL_AI_PROVIDER: EmailAiProvider = "anthropic";

export function inferEmailAiProviderFromModel(model: unknown): EmailAiProvider | null {
  return inferAiProviderFromModel(model);
}

export function isAllowedEmailAiModel(provider: string, model: unknown): boolean {
  return isSelectableAiModel(provider, model, "email_triage");
}

export function resolveEmailAiModelConfig({
  provider,
  model,
}: { provider?: unknown; model?: unknown } = {}): {
  provider: EmailAiProvider;
  model: string;
} {
  return resolveStoredAiModelConfig({
    provider,
    model,
    useCase: "email_triage",
    defaultProvider: DEFAULT_EMAIL_AI_PROVIDER,
  });
}

export function emailAiModelAvailability() {
  return aiModelCatalogService.availability("email_triage");
}
