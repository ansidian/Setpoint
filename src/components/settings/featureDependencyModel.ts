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

export function projectProviderModelControl({
  providers,
  provider,
  model,
}: {
  providers: readonly ProviderModelAvailability[];
  provider: string;
  model: string;
}) {
  const selectedProvider = providers.find((entry) => entry.provider === provider) ?? providers[0];
  const listedModel = selectedProvider?.models.find((entry) => entry.id === model);
  const preserveUnlistedModel = Boolean(
    model && selectedProvider && modelMatchesProvider(selectedProvider.provider, model),
  );
  const selectedModel = listedModel || preserveUnlistedModel
    ? model
    : selectedProvider?.defaultModel ?? "";
  const modelOptions = selectedProvider && selectedModel && !listedModel && preserveUnlistedModel
    ? [{ id: selectedModel, label: `${selectedModel} (saved; not currently listed)` }, ...selectedProvider.models]
    : selectedProvider?.models ?? [];

  return { selectedProvider, selectedModel, modelOptions };
}

export function projectAiSettingsSelectionPatch(
  surface: "alfred" | "bill_extract" | "email_ai",
  provider: string,
  model: string,
) {
  if (surface === "alfred") return { alfred_provider: provider, alfred_model: model };
  if (surface === "bill_extract") {
    return { bill_extract_provider: provider, bill_extract_model: model };
  }
  return { email_ai_provider: provider, email_ai_model: model };
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
    const isSelectedProvider = provider.provider === selectedProvider;
    if (state !== "connected" && !isSelectedProvider) return [];
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
