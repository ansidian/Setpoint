import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { getBillExtractModels } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import ProviderModelSelect from "@/components/settings/shared/ProviderModelSelect";
import { isDemoMode } from "@/demo/config";

const FALLBACK_PROVIDERS = [
  {
    provider: "anthropic",
    label: "Anthropic",
    available: true,
    defaultModel: "claude-haiku-4-5",
    models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
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
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    ],
  },
];

const DEMO_PROVIDERS = [
  {
    provider: "demo",
    label: "Demo",
    available: true,
    defaultModel: "demo-bill-extract-model",
    models: [{ id: "demo-bill-extract-model", label: "Demo bill model" }],
  },
];

export default function BillExtractionAiCard({ settings, setSettings, patch }) {
  const demoMode = isDemoMode();
  const [providers, setProviders] = useState(demoMode ? DEMO_PROVIDERS : FALLBACK_PROVIDERS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getBillExtractModels()
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

  const selectedProvider = demoMode ? "demo" : settings?.bill_extract_provider || "anthropic";
  const selectedModel = demoMode ? "demo-bill-extract-model" : settings?.bill_extract_model || "claude-haiku-4-5";

  const providerEntry = providers.find((p) => p.provider === selectedProvider) || providers[0];

  function applyChange(nextProvider, nextModel) {
    const next = providers.find((p) => p.provider === nextProvider) || providers[0];
    const model = next.models.some((m) => m.id === nextModel) ? nextModel : next.defaultModel;
    setSettings((current) => ({
      ...(current || {}),
      bill_extract_provider: nextProvider,
      bill_extract_model: model,
    }));
    patch({ bill_extract_provider: nextProvider, bill_extract_model: model });
  }

  return (
    <SettingsCard
      title="Bill Extraction AI"
      icon={<Receipt size={14} />}
      description="Model used to extract payee, amount, due date, and category from bill emails. Runs separately from the email snapshot model."
    >
      <div className="flex flex-col gap-3">
        <ProviderModelSelect
          providers={providers}
          provider={selectedProvider}
          model={selectedModel}
          onChange={applyChange}
          providerAriaLabel="Bill extraction provider"
          modelAriaLabel="Bill extraction model"
        />

        <div className="flex items-center gap-2">
          {demoMode ? (
            <StatusPill tone="neutral">Demo-only model</StatusPill>
          ) : providerEntry?.available ? (
            <StatusPill tone="success">{providerEntry.label} key configured</StatusPill>
          ) : (
            <StatusPill tone="warning">
              Set {providerEntry?.envVar || (selectedProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY")}
            </StatusPill>
          )}
          {loading ? <FieldHint>Loading providers…</FieldHint> : null}
        </div>
      </div>
    </SettingsCard>
  );
}
