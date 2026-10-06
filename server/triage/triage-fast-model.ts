import {
  aiModelCatalogService,
  getDefaultAiModel,
  isSafeStoredAiModel,
  isSelectableAiModel,
  resolveStoredAiModelConfig,
} from "../ai-model-catalog.ts";
import type { AiProvider } from "../ai-credentials.ts";

export const DEFAULT_TRIAGE_FAST_PROVIDER: AiProvider = "anthropic";
export const DEFAULT_TRIAGE_FAST_MODEL = getDefaultAiModel(
  DEFAULT_TRIAGE_FAST_PROVIDER,
  "triage_fast",
);

export function isAllowedTriageFastModel(provider: unknown, model: unknown): boolean {
  return isSelectableAiModel(provider, model, "triage_fast");
}

export function resolveTriageFastModelConfig({
  provider,
  model,
}: { provider?: unknown; model?: unknown } = {}): { provider: AiProvider; model: string } {
  if (
    provider !== undefined
    && model !== undefined
    && !isSafeStoredAiModel(provider, model)
  ) {
    return {
      provider: DEFAULT_TRIAGE_FAST_PROVIDER,
      model: DEFAULT_TRIAGE_FAST_MODEL,
    };
  }
  return resolveStoredAiModelConfig({
    provider,
    model,
    useCase: "triage_fast",
    defaultProvider: DEFAULT_TRIAGE_FAST_PROVIDER,
  });
}

export function triageFastModelAvailability() {
  return aiModelCatalogService.availability("triage_fast");
}
