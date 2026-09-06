import { describe, expect, it, vi } from "vitest";
import type { InstanceCredentialMetadata } from "../shared/types/instance-credentials.ts";
import {
  AI_MODEL_CATALOG_TTL_MS,
  ANTHROPIC_FALLBACK_MODELS,
  OPENAI_MODELS,
  createAiModelCatalogService,
  isSelectableAiModel,
  resolveStoredAiModelConfig,
} from "./ai-model-catalog.ts";
import type { AiProvider } from "./ai-credentials.ts";

function credential(
  provider: AiProvider,
  activeConfigured: boolean,
  version: number | null = 1,
): InstanceCredentialMetadata {
  return {
    key: provider === "openai" ? "ai.openai_api_key" : "ai.anthropic_api_key",
    handling: "secret",
    capabilities: [],
    source: activeConfigured ? "stored" : "absent",
    activeConfigured,
    pendingConfigured: false,
    pendingStagedAt: null,
    pendingExpiresAt: null,
    validationState: activeConfigured ? "valid" : "untested",
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: activeConfigured ? version : null,
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI model catalog", () => {
  it("returns curated OpenAI models without provider discovery", async () => {
    let fetched = false;
    const fetchImpl = async () => {
      fetched = true;
      throw new Error("OpenAI catalog must not use discovery");
    };
    const service = createAiModelCatalogService({
      fetchImpl,
      getCredentialMetadata: async (provider) => credential(provider, false),
      resolveApiKey: async () => null,
    });

    const providers = await service.availability("email_triage");
    const openai = providers.find((entry) => entry.provider === "openai");

    expect(openai?.models).toEqual(OPENAI_MODELS);
    expect(fetched).toBe(false);
  });

  it("omits non-streaming OpenAI models from Alfred availability", async () => {
    const service = createAiModelCatalogService({
      fetchImpl: vi.fn(),
      getCredentialMetadata: async (provider) => credential(provider, false),
      resolveApiKey: async () => null,
    });

    const providers = await service.availability("alfred");
    const openai = providers.find((entry) => entry.provider === "openai");

    expect(openai?.models.map(({ id }) => id)).not.toContain("gpt-5.5-pro");
    expect(isSelectableAiModel("openai", "gpt-5.5-pro", "alfred")).toBe(false);
    expect(isSelectableAiModel("openai", "gpt-5.5-pro", "email_triage")).toBe(true);
  });

  it("discovers Anthropic display names once within the cache TTL", async () => {
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      return response({
      data: [
        { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
        { id: "not-a-claude-model", display_name: "Ignore me" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
      ],
      });
    };
    const service = createAiModelCatalogService({
      fetchImpl,
      getCredentialMetadata: async (provider) => credential(provider, true, 7),
      resolveApiKey: async () => "test-key",
    });

    const first = await service.availability("email_triage");
    const second = await service.availability("bill_extraction");

    expect(first[0]?.models).toEqual([
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    ]);
    expect(second[0]?.models).toEqual(first[0]?.models);
    expect(first[0]?.pricingUrl)
      .toBe("https://platform.claude.com/docs/en/about-claude/pricing");
    expect(fetchCount).toBe(1);
  });

  it("refreshes after the TTL and uses stale discovered data if refresh fails", async () => {
    let currentTime = 1_000;
    let fetchCount = 0;
    const responses = [
      response({
        data: [{ id: "claude-opus-4-6", display_name: "Claude Opus 4.6" }],
      }),
      response({ message: "unavailable" }, 503),
    ];
    const fetchImpl = async () => responses[fetchCount++]!;
    const service = createAiModelCatalogService({
      fetchImpl,
      getCredentialMetadata: async (provider) => credential(provider, true, 3),
      resolveApiKey: async () => "test-key",
      now: () => currentTime,
    });

    const first = await service.availability("email_triage");
    currentTime += AI_MODEL_CATALOG_TTL_MS + 1;
    const stale = await service.availability("email_triage");

    expect(stale[0]?.models).toEqual(first[0]?.models);
    expect(fetchCount).toBe(2);
  });

  it("uses the emergency Anthropic fallback when discovery has never succeeded", async () => {
    const service = createAiModelCatalogService({
      fetchImpl: vi.fn(async () => response({ message: "unavailable" }, 503)),
      getCredentialMetadata: async (provider) => credential(provider, true),
      resolveApiKey: async () => "test-key",
    });

    const providers = await service.availability("email_triage");

    expect(providers[0]?.models).toEqual(ANTHROPIC_FALLBACK_MODELS);
  });

  it("does not discover Anthropic models without an active credential", async () => {
    let fetched = false;
    let resolvedApiKey = false;
    const fetchImpl = async () => {
      fetched = true;
      throw new Error("Missing credentials must prevent discovery");
    };
    const resolveApiKey = async () => {
      resolvedApiKey = true;
      return null;
    };
    const service = createAiModelCatalogService({
      fetchImpl,
      getCredentialMetadata: async (provider) => credential(provider, false),
      resolveApiKey,
    });

    const providers = await service.availability("email_triage");

    expect(providers[0]?.available).toBe(false);
    expect(providers[0]?.models).toEqual(ANTHROPIC_FALLBACK_MODELS);
    expect(resolvedApiKey).toBe(false);
    expect(fetched).toBe(false);
  });

  it("accepts discovered Claude IDs but only curated OpenAI IDs for new selections", () => {
    expect(isSelectableAiModel("anthropic", "claude-opus-9-1", "email_triage")).toBe(true);
    expect(isSelectableAiModel("anthropic", "gpt-5.6-sol", "email_triage")).toBe(false);
    expect(isSelectableAiModel("openai", "gpt-5.6-sol", "email_triage")).toBe(true);
    expect(isSelectableAiModel("openai", "gpt-9.9", "email_triage")).toBe(false);
  });

  it("preserves safe stored models that are no longer selectable", () => {
    expect(resolveStoredAiModelConfig({
      provider: "openai",
      model: "gpt-5.3",
      useCase: "email_triage",
    })).toEqual({
      provider: "openai",
      model: "gpt-5.3",
    });
    expect(resolveStoredAiModelConfig({
      provider: "anthropic",
      model: "claude-future-7",
      useCase: "bill_extraction",
    })).toEqual({
      provider: "anthropic",
      model: "claude-future-7",
    });
  });
});
