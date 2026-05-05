import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { getModels } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import ProviderModelSelect from "@/components/settings/shared/ProviderModelSelect";

const FALLBACK_PROVIDERS = [
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

function inferProvider(model) {
  if (model?.startsWith("gpt-")) return "openai";
  return "anthropic";
}

export default function EmailAiModelCard({ settings, setSettings, patch }) {
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
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

  const legacyModel = settings?.claude_model;
  const selectedProvider = settings?.email_ai_provider
    || inferProvider(settings?.email_ai_model || legacyModel);
  const providerEntry = providers.find((entry) => entry.provider === selectedProvider) || providers[0];
  const selectedModel = settings?.email_ai_model
    || legacyModel
    || providerEntry?.defaultModel
    || "claude-sonnet-4-6";

  function applyChange(nextProvider, nextModel) {
    const next = providers.find((entry) => entry.provider === nextProvider) || providers[0];
    const model = next.models.some((entry) => entry.id === nextModel) ? nextModel : next.defaultModel;
    setSettings((current) => ({
      ...(current || {}),
      email_ai_provider: nextProvider,
      email_ai_model: model,
      claude_model: model,
    }));
    patch({
      email_ai_provider: nextProvider,
      email_ai_model: model,
      claude_model: model,
    });
  }

  return (
    <SettingsCard
      title="Email Snapshot AI"
      icon={<Bot size={14} />}
      description="Model used for email snapshot summaries and triage context. Bill extraction uses its own model."
    >
      <div className="flex flex-col gap-3">
        <ProviderModelSelect
          providers={providers}
          provider={selectedProvider}
          model={selectedModel}
          onChange={applyChange}
          providerAriaLabel="Email summary provider"
          modelAriaLabel="Email summary model"
        />

        <div className="flex items-center gap-2">
          {providerEntry?.available ? (
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
