import type { AlfredModelId } from "../../shared/types/alfred.ts";

export const ALFRED_MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku" },
 ] as const satisfies ReadonlyArray<{ id: AlfredModelId; label: string }>;

export const DEFAULT_ALFRED_MODEL: AlfredModelId = "claude-sonnet-4-6";

export function resolveAlfredModel(requested: unknown): AlfredModelId | null {
  if (!requested) return DEFAULT_ALFRED_MODEL;
  const match = ALFRED_MODELS.find((model) => model.id === requested);
  return match ? match.id : null;
}
