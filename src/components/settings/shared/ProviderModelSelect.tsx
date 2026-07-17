import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/settings/settings-ui";
import type { ProviderModelAvailability } from "../../../../shared/types/settings";

const SELECT_CONTENT_CLASS = "bg-[var(--sp-panel)] shadow-[0_20px_60px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.08]";
const SELECT_TRIGGER_CLASS = "w-full bg-input/30 transition-colors hover:bg-input/50";

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
  const selectedModel = selectedProvider?.models?.some((entry) => entry.id === model)
    ? model
    : selectedProvider?.defaultModel;

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
            <SelectValue />
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" className={SELECT_CONTENT_CLASS}>
            {(selectedProvider?.models || []).map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="text-[13px]">
                {entry.label || entry.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
