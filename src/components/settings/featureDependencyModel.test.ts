import { describe, expect, it } from "vitest";
import type { ProviderModelAvailability } from "../../../shared/types/settings";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "./connectionModel";
import {
  projectAiProviderSelection,
  projectFeatureDependencies,
} from "./featureDependencyModel";

function connection(id: ConnectionId, state: ConnectionState): ConnectionRowView {
  return {
    id,
    group: id === "openai" || id === "anthropic" ? "ai_providers" : "data_sources",
    label: id,
    description: "",
    minimumViable: "",
    hash: id,
    state,
    statusLabel: state,
    source: "absent",
    mode: null,
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

const PROVIDERS: ProviderModelAvailability[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    available: true,
    defaultModel: "claude-sonnet",
    models: [{ id: "claude-sonnet", label: "Sonnet" }],
  },
  {
    provider: "openai",
    label: "OpenAI",
    available: true,
    defaultModel: "gpt-default",
    models: [
      { id: "gpt-default", label: "GPT default" },
      { id: "gpt-saved", label: "GPT saved" },
    ],
  },
];

describe("feature dependency projection", () => {
  it.each([
    {
      name: "not connected",
      connections: [
        connection("google-workspace", "not_connected"),
        connection("icloud-mail", "not_connected"),
        connection("openai", "not_connected"),
        connection("anthropic", "not_connected"),
        connection("actual-budget", "not_connected"),
      ],
      expected: {
        automation: {
          email: "not_connected",
          ai: "not_connected",
          showEmailControls: false,
          showAiControls: false,
        },
        finance: {
          actual: "not_connected",
          showSettings: false,
          allowLiveMetadata: false,
        },
      },
    },
    {
      name: "connected",
      connections: [
        connection("google-workspace", "connected"),
        connection("icloud-mail", "not_connected"),
        connection("openai", "connected"),
        connection("anthropic", "not_connected"),
        connection("actual-budget", "connected"),
      ],
      expected: {
        automation: {
          email: "connected",
          ai: "connected",
          showEmailControls: true,
          showAiControls: true,
        },
        finance: {
          actual: "connected",
          showSettings: true,
          allowLiveMetadata: true,
        },
      },
    },
    {
      name: "needs attention",
      connections: [
        connection("google-workspace", "needs_attention"),
        connection("icloud-mail", "not_connected"),
        connection("openai", "needs_attention"),
        connection("anthropic", "not_connected"),
        connection("actual-budget", "needs_attention"),
      ],
      expected: {
        automation: {
          email: "needs_attention",
          ai: "needs_attention",
          showEmailControls: false,
          showAiControls: false,
        },
        finance: {
          actual: "needs_attention",
          showSettings: true,
          allowLiveMetadata: false,
        },
      },
    },
  ])("projects $name dependencies", ({ connections, expected }) => {
    expect(projectFeatureDependencies(connections)).toEqual(expected);
  });

  it("treats either healthy email source and either healthy AI provider as sufficient", () => {
    const result = projectFeatureDependencies([
      connection("google-workspace", "needs_attention"),
      connection("icloud-mail", "connected"),
      connection("openai", "needs_attention"),
      connection("anthropic", "connected"),
      connection("actual-budget", "not_connected"),
    ]);

    expect(result.automation.email).toBe("connected");
    expect(result.automation.ai).toBe("connected");
  });
});

describe("AI provider selection projection", () => {
  it("omits disconnected providers from the provider list", () => {
    const result = projectAiProviderSelection({
      providers: PROVIDERS,
      connections: [
        connection("anthropic", "connected"),
        connection("openai", "not_connected"),
      ],
      selectedProvider: "anthropic",
      selectedModel: "claude-sonnet",
    });

    expect(result.providers.map(({ provider }) => provider)).toEqual(["anthropic"]);
    expect(result.repairConnectionId).toBeNull();
  });

  it("keeps a saved provider needing attention visible and unavailable with a repair target", () => {
    const result = projectAiProviderSelection({
      providers: PROVIDERS,
      connections: [
        connection("anthropic", "connected"),
        connection("openai", "needs_attention"),
      ],
      selectedProvider: "openai",
      selectedModel: "gpt-saved",
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-saved");
    expect(result.providers).toEqual([
      PROVIDERS[0],
      { ...PROVIDERS[1], available: false },
    ]);
    expect(result.repairConnectionId).toBe("openai");
  });

  it("preserves a saved model that is not in the current provider catalog", () => {
    const result = projectAiProviderSelection({
      providers: PROVIDERS,
      connections: [
        connection("anthropic", "connected"),
        connection("openai", "connected"),
      ],
      selectedProvider: "openai",
      selectedModel: "gpt-previous",
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-previous");
  });

  it("keeps a disconnected saved provider visible instead of displaying an unsaved fallback", () => {
    const providers = structuredClone(PROVIDERS);
    const saved = { provider: "openai", model: "gpt-saved" };

    const result = projectAiProviderSelection({
      providers,
      connections: [
        connection("anthropic", "connected"),
        connection("openai", "not_connected"),
      ],
      selectedProvider: saved.provider,
      selectedModel: saved.model,
    });

    expect(result).toMatchObject({ provider: "openai", model: "gpt-saved" });
    expect(result.providers).toEqual([
      PROVIDERS[0],
      { ...PROVIDERS[1], available: false },
    ]);
    expect(saved).toEqual({ provider: "openai", model: "gpt-saved" });
    expect(providers).toEqual(PROVIDERS);
  });
});
