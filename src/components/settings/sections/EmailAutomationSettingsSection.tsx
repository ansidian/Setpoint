import { BrainCircuit, Clock, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SectionLabel,
  SettingsCard,
} from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS } from "@/components/settings/settings-core";
import EmailTriageModeCard from "@/components/settings/cards/EmailTriageModeCard";
import TriageSoundSettingsCard from "@/components/settings/cards/TriageSoundSettingsCard";
import EmailAiModelCard from "@/components/settings/cards/EmailAiModelCard";
import BillExtractionAiCard from "@/components/settings/cards/BillExtractionAiCard";
import BriefingSchedulesCard from "@/components/settings/cards/BriefingSchedulesCard";
import ImportantSendersCard from "@/components/settings/cards/ImportantSendersCard";
import CoreProviderCredentialsCard from "@/components/settings/cards/CoreProviderCredentialsCard";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { FormEvent } from "react";

export default function EmailAutomationSettingsSection({ settings, setSettings, patch }: SettingsCardStateProps) {
  const emailInterests = settings?.email_interests || [];

  return (
    <>
      <EmailTriageModeCard settings={settings} setSettings={setSettings} patch={patch} />
      <TriageSoundSettingsCard settings={settings} setSettings={setSettings} patch={patch} />
      <CoreProviderCredentialsCard
        id="ai-provider-credentials"
        title="AI provider credentials"
        icon={<BrainCircuit size={14} />}
        description="Write-only provider keys used by email triage, bill extraction, search, and Alfred. Model selection stays separate below."
        credentials={[
          {
            key: "ai.openai_api_key",
            label: "OpenAI",
            inputLabel: "OpenAI API key",
            placeholder: "Enter a new API key",
            help: "Enables OpenAI-backed triage, bill extraction, semantic email search, and configured fallbacks.",
          },
          {
            key: "ai.anthropic_api_key",
            label: "Anthropic",
            inputLabel: "Anthropic API key",
            placeholder: "Enter a new API key",
            help: "Enables Anthropic-backed triage, bill extraction, Alfred, and configured fallbacks.",
          },
        ]}
      />
      <EmailAiModelCard settings={settings} setSettings={setSettings} patch={patch} />
      <BillExtractionAiCard settings={settings} setSettings={setSettings} patch={patch} />

      <SettingsCard
        title="Email Lookback"
        icon={<Clock size={14} />}
        description="Controls how far back the email snapshot looks when gathering context."
      >
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel className="mb-0 whitespace-nowrap">Fetch emails from the last</SectionLabel>
          <Input
            type="number"
            min="1"
            max="168"
            value={settings?.email_lookback_hours ?? 16}
            onChange={(event) => {
              const value = Math.max(1, Math.min(168, parseInt(event.target.value, 10) || 16));
              setSettings((current) => ({ ...(current || {}), email_lookback_hours: value }));
              patch({ email_lookback_hours: value });
            }}
            className="w-[80px] text-center"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
          <span className="text-[13px] text-muted-foreground/75">hours</span>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Email Interests"
        icon={<Tag size={14} />}
        description="Senders, brands, or keywords that should never be classified as noise."
      >
        <div className="flex flex-col gap-3">
          {emailInterests.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {emailInterests.map((tagValue, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.1] px-2.5 py-1 text-[11px] font-medium text-primary"
                >
                  {tagValue}
                  <button
                    type="button"
                    onClick={() => {
                      const nextInterests = emailInterests.filter((_, currentIndex) => currentIndex !== index);
                      setSettings((current) => ({ ...(current || {}), email_interests: nextInterests }));
                      patch({ email_interests_json: nextInterests });
                    }}
                    className="inline-flex items-center bg-transparent text-primary/60 transition-colors hover:text-primary"
                    aria-label={`Remove ${tagValue}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/75">
              No interests saved yet.
            </div>
          )}

          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("interest") as HTMLInputElement | null;
              if (!input) return;
              const value = input.value.trim();
              if (!value) return;
              const nextInterests = [...emailInterests, value];
              setSettings((current) => ({ ...(current || {}), email_interests: nextInterests }));
              input.value = "";
              patch({ email_interests_json: nextInterests });
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <Input name="interest" placeholder="e.g. Da Vien, Anthropic, GitHub…" className="flex-1" />
            <Button type="submit" size="sm" className={SETTINGS_PRIMARY_BUTTON_CLASS}>
              Add
            </Button>
          </form>
        </div>
      </SettingsCard>

      <ImportantSendersCard />
      <BriefingSchedulesCard settings={settings} setSettings={setSettings} patch={patch} />
    </>
  );
}
