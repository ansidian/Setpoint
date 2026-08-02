import type { AlfredProvider } from "../../shared/types/alfred.ts";
import type { AlfredModelAdapter } from "./alfred-types.ts";
import { anthropicAlfredAdapter } from "./anthropic-adapter.ts";
import { openAiAlfredAdapter } from "./openai-adapter.ts";

export function getAlfredModelAdapter(provider: AlfredProvider): AlfredModelAdapter {
  return provider === "openai" ? openAiAlfredAdapter : anthropicAlfredAdapter;
}
