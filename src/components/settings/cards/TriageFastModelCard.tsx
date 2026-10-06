import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { getTriageFastModels } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import ProviderModelSelect from "@/components/settings/shared/ProviderModelSelect";
import { projectAiProviderSelection, projectAiSettingsSelectionPatch } from "@/components/settings/featureDependencyModel";
import { isDemoMode } from "@/demo/config";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";

const DEMO_PROVIDERS: ProviderModelAvailability[] = [
  {
    provider: "demo",
    label: "Demo",
    available: true,
    defaultModel: "demo-triage-fast-model",
    models: [{ id: "demo-triage-fast-model", label: "Demo fast triage model" }],
  },
];

export default function TriageFastModelCard({
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
    getTriageFastModels()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length) {
          setProviders(data);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedProvider = demoMode ? "demo" : settings?.triage_fast_provider || "anthropic";
  const selectedModel = demoMode ? "demo-triage-fast-model" : settings?.triage_fast_model || "claude-haiku-4-5";

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
    const next = selection.providers.find((p) => p.provider === nextProvider) || selection.providers[0];
    if (!next) return;
    const model = next!.models.some((m) => m.id === nextModel) ? nextModel : next!.defaultModel;
    const update = projectAiSettingsSelectionPatch("triage_fast", nextProvider, model);
    setSettings((current) => ({
      ...(current || {}),
      ...update,
    }));
    patch(update);
  }

  return (
    <SettingsCard
      title="Fast Triage AI"
      icon={<Zap size={14} />}
      description="Model used for the first triage pass. Low-confidence or high-risk mail escalates to the Inbox Triage AI model."
    >
      <div className="flex flex-col gap-3">
        {selection.providers.length ? (
          <ProviderModelSelect
            providers={selection.providers}
            provider={selection.provider}
            model={selection.model}
            onChange={applyChange}
            providerAriaLabel="Fast triage provider"
            modelAriaLabel="Fast triage model"
          />
        ) : (
          <div role="status">
            <FieldHint>
              {loadError ? "Model options are unavailable. Refresh Settings to retry." : "Loading providers…"}
            </FieldHint>
          </div>
        )}

        {providerEntry ? <div className="flex items-center gap-2">
          {demoMode ? (
            <StatusPill tone="neutral">Demo-only model</StatusPill>
          ) : selection.repairConnectionId ? (
            showRepairLink ? (
              <a
                href={`/settings?tab=connections#${selection.repairConnectionId}`}
                className="rounded-md text-[11px] font-medium text-warning underline decoration-warning/40 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none"
              >
                Repair {providerEntry?.label || selectedProvider}
              </a>
            ) : (
              <StatusPill tone="warning">{providerEntry?.label || selectedProvider} unavailable</StatusPill>
            )
          ) : providerEntry?.available ? (
            <StatusPill tone="success">{providerEntry.label} key configured</StatusPill>
          ) : (
            <StatusPill tone="warning">
              Set {providerEntry?.envVar || (selectedProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY")}
            </StatusPill>
          )}
          {loading ? <FieldHint>Loading providers…</FieldHint> : null}
        </div> : null}
      </div>
    </SettingsCard>
  );
}
