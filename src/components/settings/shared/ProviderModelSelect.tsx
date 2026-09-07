import Dropdown from "@/components/shared/Dropdown";
import { SectionLabel } from "@/components/settings/settings-ui";
import { ExternalLink } from "lucide-react";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";
import { projectProviderModelControl } from "../featureDependencyModel";

export default function ProviderModelSelect({
  providers,
  provider,
  model,
  onChange,
  disabled = false,
  providerLabel = "Provider",
  modelLabel = "Model",
  providerAriaLabel,
  modelAriaLabel,
}: {
  providers: ProviderModelAvailability[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  disabled?: boolean;
  providerLabel?: string;
  modelLabel?: string;
  providerAriaLabel?: string;
  modelAriaLabel?: string;
}) {
  const { selectedProvider, selectedModel, modelOptions } = projectProviderModelControl({
    providers,
    provider,
    model,
  });
  function changeProvider(nextProvider: string | null) {
    if (!nextProvider) return;
    const entry = providers.find((item) => item.provider === nextProvider) || providers[0];
    onChange(nextProvider, entry?.defaultModel || "");
  }

  function changeModel(nextModel: string | null) {
    if (!nextModel) return;
    onChange(selectedProvider?.provider || provider, nextModel);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <SectionLabel className="mb-0">{providerLabel}</SectionLabel>
        <Dropdown
          ariaLabel={providerAriaLabel || providerLabel}
          value={selectedProvider?.provider || provider}
          onChange={changeProvider}
          disabled={disabled}
          placeholder={provider}
          options={providers.map(entry => ({
            id: entry.provider,
            name: `${entry.label}${entry.available ? "" : " (unavailable)"}`,
            disabled: !entry.available,
          }))}
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel className="mb-0">{modelLabel}</SectionLabel>
        <Dropdown
          ariaLabel={modelAriaLabel || modelLabel}
          value={selectedModel}
          onChange={changeModel}
          disabled={disabled || !selectedProvider?.available}
          placeholder={selectedModel}
          options={modelOptions.map(entry => ({ id: entry.id, name: entry.label || entry.id }))}
        />
      </div>

      {selectedProvider?.pricingUrl ? (
        <div className="flex justify-start sm:col-span-2 sm:justify-end">
          <a
            href={selectedProvider.pricingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[var(--sp-touch-min)] items-center gap-1 rounded-md px-1 text-[11px] font-medium text-muted-foreground underline decoration-muted-foreground/35 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none sm:min-h-0"
            aria-label={`${selectedProvider.label} API pricing (opens in a new tab)`}
          >
            {selectedProvider.label} API pricing
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  );
}
