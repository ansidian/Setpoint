import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { getModels } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import ProviderModelSelect from "@/components/settings/shared/ProviderModelSelect";
import { projectAiProviderSelection } from "@/components/settings/featureDependencyModel";
import { isDemoMode } from "@/demo/config";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";

const FALLBACK_PROVIDERS: ProviderModelAvailability[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    available: true,
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    models: [
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    available: false,
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    ],
  },
];

const DEMO_PROVIDERS: ProviderModelAvailability[] = [
  {
    provider: "demo",
    label: "Demo",
    available: true,
    defaultModel: "demo-triage-model",
    models: [{ id: "demo-triage-model", label: "Demo triage model" }],
  },
];

function inferProvider(model?: string) {
  if (model?.startsWith("gpt-")) return "openai";
  return "anthropic";
}

export default function EmailAiModelCard({
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
  const [providers, setProviders] = useState(demoMode ? DEMO_PROVIDERS : FALLBACK_PROVIDERS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length) setProviders(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedProvider = demoMode
    ? "demo"
    : settings?.email_ai_provider
    || inferProvider(settings?.email_ai_model);
  const selectedModel = settings?.email_ai_model
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
    const next = selection.providers.find((entry) => entry.provider === nextProvider) || selection.providers[0];
    if (!next) return;
    const model = next!.models.some((entry) => entry.id === nextModel) ? nextModel : next!.defaultModel;
    setSettings((current) => ({
      ...(current || {}),
      email_ai_provider: nextProvider,
      email_ai_model: model,
    }));
    patch({
      email_ai_provider: nextProvider,
      email_ai_model: model,
    });
  }

  return (
    <SettingsCard
      title="Inbox Triage AI"
      icon={<Bot size={14} />}
      description="Model used for durable inbox triage. Bill extraction uses its own model."
    >
      <div className="flex flex-col gap-3">
        <ProviderModelSelect
          providers={selection.providers}
          provider={selection.provider}
          model={selection.model}
          onChange={applyChange}
          providerAriaLabel="Inbox triage provider"
          modelAriaLabel="Inbox triage model"
        />

        <div className="flex items-center gap-2">
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
            <StatusPill tone="warning">Set {providerEntry?.envVar || "ANTHROPIC_API_KEY"}</StatusPill>
          )}
          {loading ? <FieldHint>Loading providers…</FieldHint> : null}
        </div>
      </div>
    </SettingsCard>
  );
}
