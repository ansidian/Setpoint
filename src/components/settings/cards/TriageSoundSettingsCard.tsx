import { BellRing, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import Dropdown from "@/components/shared/Dropdown";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import {
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import {
  normalizeTriageSoundSettings,
  resolveTriageSoundRegistry,
  TRIAGE_SOUND_LANE_SCOPES,
  TRIAGE_SOUND_TRIGGER_ROWS,
  updateTriageSoundTrigger,
  updateTriageSoundVolume,
} from "@/lib/triageSoundSettings";
import type { SettingsCardStateProps } from "../settingsTypes";
import { playTriageNotificationSound } from "@/lib/triageSoundPlayback";
import { cn } from "@/lib/utils";
import type { TriageSoundLaneScope, TriageSoundSettings, TriageSoundTriggerKey, TriageSoundTriggerSetting } from "@/lib/triageSoundSettings";

const LANE_SCOPE_OPTIONS = [
  {
    value: TRIAGE_SOUND_LANE_SCOPES.NEEDS_ATTENTION_AND_FYI,
    label: "Needs attention + FYI",
  },
  {
    value: TRIAGE_SOUND_LANE_SCOPES.NEEDS_ATTENTION_ONLY,
    label: "Needs attention only",
  },
];

export default function TriageSoundSettingsCard({ settings, setSettings, patch, scope = "triage" }: SettingsCardStateProps & { scope?: "triage" | "finance" }) {
  const soundSettings = normalizeTriageSoundSettings(settings?.triage_sound_settings);
  const sounds = resolveTriageSoundRegistry(settings?.triage_notification_sounds);

  function applySoundSettings(nextSettings: TriageSoundSettings) {
    setSettings((current) => ({
      ...(current || {}),
      triage_sound_settings: nextSettings,
    }));
    patch({ triage_sound_settings: nextSettings });
  }

  function updateVolume(value: string | number) {
    applySoundSettings(updateTriageSoundVolume(soundSettings, value));
  }

  function updateTrigger(triggerKey: TriageSoundTriggerKey, updates: Partial<TriageSoundTriggerSetting>) {
    applySoundSettings(updateTriageSoundTrigger(soundSettings, triggerKey, updates));
  }

  function previewSound(soundId: string) {
    void playTriageNotificationSound(sounds.find(entry => entry.id === soundId), {
      markUnlocked: true,
      volume: soundSettings.volume,
    });
  }

  const volumeControl = (
    <div className={cn("space-y-1", scope === "finance" && "w-32")}>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel className="mb-0">{scope === "finance" ? "All sounds" : "Volume"}</SectionLabel>
                <span className="text-[11px] font-medium text-muted-foreground/75">
                  {Math.round(soundSettings.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={soundSettings.volume}
                onChange={(event) => updateVolume(event.target.value)}
                aria-label="Notification sound volume"
                className="h-2 w-full cursor-pointer accent-primary"
              />
            </div>
  );

  return (
    <SettingsCard
      title={scope === "finance" ? "Actual Notification Sound" : "Triage Notification Sounds"}
      icon={<BellRing size={14} />}
      description={scope === "finance" ? "A brief confirmation after recording a payment in Actual." : "Controls app-level sounds for triage transitions. Browser notification permission is separate."}
    >
      <div className="flex flex-col gap-3">
        {scope === "triage" && <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_150px] lg:items-center">
            <div>
              <SectionLabel className="mb-1">Finalized lane scope</SectionLabel>
              <FieldHint>Choose which finalized lanes can play sound.</FieldHint>
            </div>
            <Dropdown
              ariaLabel="Finalized lane scope"
              value={soundSettings.laneScope}
              onChange={value => applySoundSettings({ ...soundSettings, laneScope: value as TriageSoundLaneScope })}
              options={LANE_SCOPE_OPTIONS.map(option => ({ id: option.value, name: option.label }))}
            />
            {volumeControl}
          </div>
        </div>}

        <div className="overflow-hidden rounded-lg border border-white/[0.06]">
          {TRIAGE_SOUND_TRIGGER_ROWS.filter(row => (row.key === "actual_recorded") === (scope === "finance")).map((row) => {
            const trigger = soundSettings.triggers[row.key];
            return (
              <div
                key={row.key}
                className={cn(SURFACE_ROW_CLASS, "grid gap-3 p-3 lg:items-center", scope === "finance" ? "grid-cols-[minmax(0,1fr)_96px] lg:grid-cols-[minmax(0,1fr)_180px_128px_96px]" : "lg:grid-cols-[minmax(0,1fr)_180px_96px]")}
              >
                <label className={cn("flex min-w-0 items-start gap-3", scope === "finance" && "col-span-2 lg:col-span-1")}>
                  <input
                    type="checkbox"
                    checked={trigger.enabled}
                    onChange={(event) => updateTrigger(row.key, { enabled: event.target.checked })}
                    className="mt-0.5 size-4 rounded border-white/[0.12] bg-input/40 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">{row.label}</span>
                      <StatusPill tone={trigger.enabled ? "accent" : "neutral"}>
                        {trigger.enabled ? "On" : "Off"}
                      </StatusPill>
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground/75">
                      {row.description}
                    </span>
                  </span>
                </label>

                <div className={cn("min-w-0", scope === "finance" && "col-span-2 lg:col-span-1")}><Dropdown
                  ariaLabel={`${row.label} sound`}
                  value={trigger.soundId}
                  onChange={soundId => {
                    updateTrigger(row.key, { soundId });
                    previewSound(soundId);
                  }}
                  options={sounds.map(entry => ({ id: entry.id, name: entry.label || entry.id }))}
                /></div>

                {scope === "finance" && volumeControl}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, "justify-center focus-visible:-translate-y-px")}
                  onClick={() => previewSound(trigger.soundId)}
                >
                  <Play size={13} />
                  Test
                </Button>
              </div>
            );
          })}
        </div>

      </div>
    </SettingsCard>
  );
}
