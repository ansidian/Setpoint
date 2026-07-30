import {
  aiModelCatalogService,
  getDefaultAiModel,
  isSafeStoredAiModel,
  isSelectableAiModel,
  resolveStoredAiModelConfig,
} from "../../ai-model-catalog.ts";

export const DEFAULT_BILL_EXTRACT_PROVIDER = "anthropic";
export const DEFAULT_BILL_EXTRACT_MODEL = getDefaultAiModel(
  DEFAULT_BILL_EXTRACT_PROVIDER,
  "bill_extraction",
);

export function isAllowedBillExtractModel(provider: unknown, model: unknown): boolean {
  return isSelectableAiModel(provider, model, "bill_extraction");
}

export function resolveBillExtractModelConfig({
  provider,
  model,
}: { provider?: unknown; model?: unknown } = {}) {
  if (
    provider !== undefined
    && model !== undefined
    && !isSafeStoredAiModel(provider, model)
  ) {
    return {
      provider: DEFAULT_BILL_EXTRACT_PROVIDER,
      model: DEFAULT_BILL_EXTRACT_MODEL,
    };
  }
  return resolveStoredAiModelConfig({
    provider,
    model,
    useCase: "bill_extraction",
    defaultProvider: DEFAULT_BILL_EXTRACT_PROVIDER,
  });
}

export function billExtractAvailability() {
  return aiModelCatalogService.availability("bill_extraction");
}
