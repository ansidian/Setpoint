import { useState } from "react";
import { BellRing, Play, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/lib/triageSoundSettings";
import { playTriageNotificationSound } from "@/lib/triageSoundPlayback";
import { cn } from "@/lib/utils";

const SELECT_CONTENT_CLASS = "bg-[var(--sp-panel)] shadow-[0_20px_60px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.08]";
const SELECT_TRIGGER_CLASS = "h-8 w-full min-w-[150px] bg-input/30 text-[12px] transition-colors hover:bg-input/50";

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

export default function TriageSoundSettingsCard({ settings, setSettings, patch }) {
  const [lastTested, setLastTested] = useState(null);
  const soundSettings = normalizeTriageSoundSettings(settings?.triage_sound_settings);
  const sounds = resolveTriageSoundRegistry(settings?.triage_notification_sounds);

  function applySoundSettings(nextSettings) {
    setSettings((current) => ({
      ...(current || {}),
      triage_sound_settings: nextSettings,
    }));
    patch({ triage_sound_settings: nextSettings });
  }

  function updateVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value)));
    applySoundSettings({
      ...soundSettings,
      volume: Number.isFinite(volume) ? volume : 1,
    });
  }

  function updateTrigger(triggerKey, updates) {
    applySoundSettings({
      ...soundSettings,
      triggers: {
        ...soundSettings.triggers,
        [triggerKey]: {
          ...soundSettings.triggers[triggerKey],
          ...updates,
        },
      },
    });
  }

  return (
    <SettingsCard
      title="Triage Notification Sounds"
      icon={<BellRing size={14} />}
      description="Controls app-level sounds for triage transitions. Browser notification permission is separate."
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_150px] lg:items-center">
            <div>
              <SectionLabel className="mb-1">Finalized lane scope</SectionLabel>
              <FieldHint>Choose which finalized lanes can play sound.</FieldHint>
            </div>
            <Select
              value={soundSettings.laneScope}
              onValueChange={(value) => applySoundSettings({ ...soundSettings, laneScope: value })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="Finalized lane scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className={SELECT_CONTENT_CLASS}>
                {LANE_SCOPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[13px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel className="mb-0">Volume</SectionLabel>
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
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-white/[0.06]">
          {TRIAGE_SOUND_TRIGGER_ROWS.map((row) => {
            const trigger = soundSettings.triggers[row.key];
            const sound = sounds.find((entry) => entry.id === trigger.soundId) || sounds[0];
            return (
              <div
                key={row.key}
                className={cn(SURFACE_ROW_CLASS, "grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_180px_96px] lg:items-center")}
              >
                <label className="flex min-w-0 items-start gap-3">
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

                <Select
                  value={trigger.soundId}
                  onValueChange={(soundId) => updateTrigger(row.key, { soundId })}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={`${row.label} sound`}>
                    <Volume2 size={13} className="text-primary/75" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" className={SELECT_CONTENT_CLASS}>
                    {sounds.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id} className="text-[13px]">
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, "justify-center")}
                  onClick={() => {
                    playTriageNotificationSound(sound, {
                      markUnlocked: true,
                      volume: soundSettings.volume,
                    });
                    setLastTested(row.key);
                  }}
                >
                  <Play size={13} />
                  Test
                </Button>
              </div>
            );
          })}
        </div>

        <FieldHint>
          {lastTested ? "Test playback unlocks audio for this browser session when the browser allows it." : "Use Test once after opening the app so the browser can allow playback."}
        </FieldHint>
      </div>
    </SettingsCard>
  );
}
