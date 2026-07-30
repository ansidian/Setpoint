import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/settings/settings-ui";
import { ExternalLink } from "lucide-react";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";

const SELECT_CONTENT_CLASS = "bg-[var(--sp-panel)] shadow-[0_20px_60px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.08]";
const SELECT_TRIGGER_CLASS = "w-full bg-input/30 transition-colors hover:bg-input/50";

function modelMatchesProvider(provider: string | undefined, model: string): boolean {
  if (provider === "openai") return model.startsWith("gpt-");
  if (provider === "anthropic") return model.startsWith("claude-");
  return true;
}

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
  const selectedProvider = providers.find((entry) => entry.provider === provider) || providers[0];
  const listedModel = selectedProvider?.models.find((entry) => entry.id === model);
  const preserveUnlistedModel = Boolean(
    model && selectedProvider && modelMatchesProvider(selectedProvider.provider, model),
  );
  const selectedModel = listedModel || preserveUnlistedModel
    ? model
    : selectedProvider?.defaultModel || "";
  const modelOptions = selectedProvider && selectedModel && !listedModel && preserveUnlistedModel
    ? [
      {
        id: selectedModel,
        label: `${selectedModel} (saved; not currently listed)`,
      },
      ...selectedProvider.models,
    ]
    : selectedProvider?.models || [];
  const selectedModelLabel = listedModel?.label
    || modelOptions.find((entry) => entry.id === selectedModel)?.label
    || selectedModel;

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
        <Select
          value={selectedProvider?.provider || provider}
          onValueChange={changeProvider}
          disabled={disabled}
        >
          <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={providerAriaLabel || providerLabel}>
            <SelectValue>{selectedProvider?.label || provider}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" className={SELECT_CONTENT_CLASS}>
            {providers.map((entry) => (
              <SelectItem
                key={entry.provider}
                value={entry.provider}
                disabled={!entry.available}
                className="text-[13px]"
              >
                {entry.label}
                {!entry.available ? " (unavailable)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <SectionLabel className="mb-0">{modelLabel}</SectionLabel>
        <Select
          value={selectedModel}
          onValueChange={changeModel}
          disabled={disabled || !selectedProvider?.available}
        >
          <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={modelAriaLabel || modelLabel}>
            <SelectValue>{selectedModelLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" className={SELECT_CONTENT_CLASS}>
            {modelOptions.map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="text-[13px]">
                {entry.label || entry.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
