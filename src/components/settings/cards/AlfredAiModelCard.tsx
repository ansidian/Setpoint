import { useEffect, useState } from "react";
import { MessageCircleMore } from "lucide-react";
import { getAlfredModels } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import ProviderModelSelect from "@/components/settings/shared/ProviderModelSelect";
import { projectAiProviderSelection } from "@/components/settings/featureDependencyModel";
import { isDemoMode } from "@/demo/config";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";

const DEMO_PROVIDERS: ProviderModelAvailability[] = [{
  provider: "demo",
  label: "Demo",
  available: true,
  defaultModel: "demo-alfred-model",
  models: [{ id: "demo-alfred-model", label: "Demo Alfred model" }],
}];

function inferProvider(model?: string): string {
  return model?.startsWith("gpt-") ? "openai" : "anthropic";
}

export default function AlfredAiModelCard({
  settings,
  setSettings,
  patch,
  connections,
  showRepairLink = true,
}: SettingsCardStateProps & {
  connections?: readonly ConnectionRowView[];
  showRepairLink?: boolean;
}) {
  const demoMode = isDemoMode();
  const [providers, setProviders] = useState<ProviderModelAvailability[]>(
    demoMode ? DEMO_PROVIDERS : [],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAlfredModels()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length) setProviders(data);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedProvider = demoMode
    ? "demo"
    : settings?.alfred_provider || inferProvider(settings?.alfred_model);
  const selectedModel = settings?.alfred_model
    || providers.find((entry) => entry.provider === selectedProvider)?.defaultModel
    || "claude-sonnet-4-6";
  const selection = connections
    ? projectAiProviderSelection({
      providers,
      connections,
      selectedProvider,
      selectedModel,
    })
    : {
      providers,
      provider: selectedProvider,
      model: selectedModel,
      repairConnectionId: null,
    };
  const providerEntry = selection.providers.find((entry) => entry.provider === selection.provider)
    || selection.providers[0];

  function applyChange(nextProvider: string, nextModel: string) {
    const next = selection.providers.find((entry) => entry.provider === nextProvider)
      || selection.providers[0];
    if (!next) return;
    const model = next.models.some((entry) => entry.id === nextModel)
      ? nextModel
      : next.defaultModel;
    setSettings((current) => ({
      ...(current || {}),
      alfred_provider: nextProvider,
      alfred_model: model,
    }));
    patch({ alfred_provider: nextProvider, alfred_model: model });
  }

  return (
    <SettingsCard
      id="alfred-ai"
      title="Alfred AI"
      icon={<MessageCircleMore size={14} />}
      description="Default provider and model for new Alfred conversations. Existing conversations keep the model they started with."
    >
      <div className="flex flex-col gap-3">
        {selection.providers.length ? (
          <ProviderModelSelect
            providers={selection.providers}
            provider={selection.provider}
            model={selection.model}
            onChange={applyChange}
            providerAriaLabel="Alfred provider"
            modelAriaLabel="Alfred model"
          />
        ) : (
          <div role="status">
            <FieldHint>
              {loadError ? "Model options are unavailable. Refresh Settings to retry." : "Loading providers…"}
            </FieldHint>
          </div>
        )}

        {providerEntry ? (
          <div className="flex items-center gap-2">
            {demoMode ? (
              <StatusPill tone="neutral">Demo-only model</StatusPill>
            ) : selection.repairConnectionId ? (
              showRepairLink ? (
                <a
                  href={`/settings?tab=connections#${selection.repairConnectionId}`}
                  className="rounded-md text-[11px] font-medium text-warning underline decoration-warning/40 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none"
                >
                  Repair {providerEntry.label || selectedProvider}
                </a>
              ) : (
                <StatusPill tone="warning">{providerEntry.label || selectedProvider} unavailable</StatusPill>
              )
            ) : providerEntry.available ? (
              <StatusPill tone="success">{providerEntry.label} key configured</StatusPill>
            ) : (
              <StatusPill tone="warning">Set {providerEntry.envVar || "provider API key"}</StatusPill>
            )}
            {loading ? <FieldHint>Loading providers…</FieldHint> : null}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
