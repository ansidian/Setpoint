import type { ProviderModelAvailability } from "../../../shared/types/settings";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "./connectionModel";

export type FeatureDependencyState = "connected" | "needs_attention" | "not_connected";

export interface FeatureDependencies {
  automation: {
    email: FeatureDependencyState;
    ai: FeatureDependencyState;
    showEmailControls: boolean;
    showAiControls: boolean;
  };
  finance: {
    actual: FeatureDependencyState;
    showSettings: boolean;
    allowLiveMetadata: boolean;
  };
}

const EMAIL_CONNECTION_IDS = ["google-workspace", "icloud-mail"] as const;
const AI_CONNECTION_IDS = ["openai", "anthropic"] as const;

const PROVIDER_CONNECTION_IDS: Record<string, ConnectionId> = {
  anthropic: "anthropic",
  openai: "openai",
};

function modelMatchesProvider(provider: string | undefined, model: string): boolean {
  if (provider === "openai") return model.startsWith("gpt-");
  if (provider === "anthropic") return model.startsWith("claude-");
  return true;
}

function dependencyState(
  connections: readonly ConnectionRowView[],
  ids: readonly ConnectionId[],
): FeatureDependencyState {
  const states = ids.map((id) => connections.find((connection) => connection.id === id)?.state);
  if (states.includes("connected")) return "connected";
  if (states.includes("needs_attention")) return "needs_attention";
  return "not_connected";
}

export function projectFeatureDependencies(
  connections: readonly ConnectionRowView[],
): FeatureDependencies {
  const email = dependencyState(connections, EMAIL_CONNECTION_IDS);
  const ai = dependencyState(connections, AI_CONNECTION_IDS);
  const actual = dependencyState(connections, ["actual-budget"]);

  return {
    automation: {
      email,
      ai,
      showEmailControls: email === "connected",
      showAiControls: email === "connected" && ai !== "not_connected",
    },
    finance: {
      actual,
      showSettings: actual !== "not_connected",
      allowLiveMetadata: actual === "connected",
    },
  };
}

export function projectAiProviderSelection({
  providers,
  connections,
  selectedProvider,
  selectedModel,
}: {
  providers: readonly ProviderModelAvailability[];
  connections: readonly ConnectionRowView[];
  selectedProvider: string;
  selectedModel: string;
}) {
  const stateById = new Map<ConnectionId, ConnectionState | null>(
    connections.map(({ id, state }) => [id, state]),
  );
  const projectedProviders = providers.flatMap((provider) => {
    const connectionId = PROVIDER_CONNECTION_IDS[provider.provider];
    const state = connectionId ? stateById.get(connectionId) : undefined;
    if (!connectionId) return [{ ...provider }];
    const isSelectedRepair = provider.provider === selectedProvider && state === "needs_attention";
    if (state !== "connected" && !isSelectedRepair) return [];
    return [{
      ...provider,
      available: state === "connected" && provider.available,
    }];
  });
  const selectedEntry = projectedProviders.find(({ provider }) => provider === selectedProvider)
    ?? projectedProviders.find(({ available }) => available)
    ?? projectedProviders[0];
  const model = selectedEntry?.models.some(({ id }) => id === selectedModel)
    || modelMatchesProvider(selectedEntry?.provider, selectedModel)
    ? selectedModel
    : selectedEntry?.defaultModel ?? selectedModel;
  const repairConnectionId = selectedEntry?.provider === selectedProvider
    && PROVIDER_CONNECTION_IDS[selectedProvider]
    && stateById.get(PROVIDER_CONNECTION_IDS[selectedProvider]!) === "needs_attention"
    ? PROVIDER_CONNECTION_IDS[selectedProvider]!
    : null;

  return {
    providers: projectedProviders,
    provider: selectedEntry?.provider ?? selectedProvider,
    model,
    repairConnectionId,
  };
}
