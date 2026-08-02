import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import {
  aiModelCatalogService,
  getDefaultAiModel,
  isSelectableAiModel,
  resolveStoredAiModelConfig,
} from "../ai-model-catalog.ts";
import type { AiProvider } from "../ai-credentials.ts";

export const DEFAULT_ALFRED_PROVIDER: AiProvider = "anthropic";
export const DEFAULT_ALFRED_MODEL = getDefaultAiModel(DEFAULT_ALFRED_PROVIDER, "alfred");

export function isAllowedAlfredModel(provider: unknown, model: unknown): boolean {
  return isSelectableAiModel(provider, model, "alfred");
}

export function resolveAlfredModelConfig({
  provider,
  model,
}: { provider?: unknown; model?: unknown } = {}): { provider: AiProvider; model: string } {
  return resolveStoredAiModelConfig({
    provider,
    model,
    useCase: "alfred",
    defaultProvider: DEFAULT_ALFRED_PROVIDER,
  });
}

export function alfredModelAvailability() {
  return aiModelCatalogService.availability("alfred");
}

export async function loadAlfredModelConfig(
  userId: string,
  dbClient: Pick<Client, "execute"> = db,
): Promise<{ provider: AiProvider; model: string }> {
  const result = await dbClient.execute({
    sql: "SELECT alfred_provider, alfred_model FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  const row = result.rows[0];
  return resolveAlfredModelConfig({
    provider: row?.alfred_provider,
    model: row?.alfred_model,
  });
}
