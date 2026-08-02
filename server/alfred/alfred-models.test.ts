import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALFRED_MODEL,
  isAllowedAlfredModel,
  loadAlfredModelConfig,
  resolveAlfredModelConfig,
} from "./alfred-models.ts";

describe("Alfred model configuration", () => {
  it("returns the Anthropic default when storage is empty", () => {
    expect(resolveAlfredModelConfig()).toEqual({ provider: "anthropic", model: DEFAULT_ALFRED_MODEL });
  });

  it("accepts discovered Anthropic and curated OpenAI models", () => {
    expect(isAllowedAlfredModel("anthropic", "claude-haiku-4-5-20251001")).toBe(true);
    expect(isAllowedAlfredModel("openai", "gpt-5.6-sol")).toBe(true);
  });

  it("falls back to the selected provider's default when its stored model is invalid", () => {
    expect(resolveAlfredModelConfig({ provider: "openai", model: "claude-sonnet-4-6" }))
      .toEqual({ provider: "openai", model: "gpt-5.6-sol" });
  });

  it("loads and normalizes the persisted pair", async () => {
    const db = {
      execute: async () => ({ rows: [{ alfred_provider: "openai", alfred_model: "gpt-5.6-sol" }] }),
    };
    await expect(loadAlfredModelConfig("user-1", db as never))
      .resolves.toEqual({ provider: "openai", model: "gpt-5.6-sol" });
  });
});
