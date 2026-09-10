import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sharedRegistry from "../../shared/triage-notification-sounds.json";
import {
  normalizeTriageSoundSettings as normalizeServerSettings,
  DEFAULT_TRIAGE_SOUND_SETTINGS as SERVER_DEFAULT_TRIAGE_SOUND_SETTINGS
} from "../../server/triage/triage-sound-settings.ts";
import {
  DEFAULT_TRIAGE_SOUND_SETTINGS,
  normalizeTriageSoundSettings,
  updateTriageSoundTrigger,
  updateTriageSoundVolume
} from "./triageSoundSettings";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("triage sound settings registry", () => {

  it("keeps every default trigger sound inside the shared registry", () => {
    const registryIds = new Set(sharedRegistry.map((sound) => sound.id));

    for (const row of Object.values(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers)) {
      expect(registryIds.has(row.soundId)).toBe(true);
    }
    for (const row of Object.values(SERVER_DEFAULT_TRIAGE_SOUND_SETTINGS.triggers)) {
      expect(registryIds.has(row.soundId)).toBe(true);
    }
  });

  it("points every registered sound at an installed public asset", () => {
    for (const sound of sharedRegistry) {
      expect(sound.path.startsWith("/sounds/notifications/")).toBe(true);
      expect(existsSync(join(repoRoot, "public", sound.path))).toBe(true);
    }
  });

  it("replaces retired selections with trigger defaults while preserving volume and enabled state", () => {
    const saved = {
      laneScope: "needs_attention_only",
      volume: 0.4,
      triggers: {
        needs_attention_finalized: { enabled: false, soundId: "clear_chime" },
        email_queued: { enabled: true, soundId: "quick_chime" },
        fyi_finalized: { enabled: true, soundId: "smooth_modern" },
        triage_failed: { enabled: false, soundId: "low_tone" },
        event_upcoming: { enabled: true, soundId: "bells_echo" },
        task_completed: { enabled: true, soundId: "hard_pop_click" },
      },
    };
    const normalized = normalizeTriageSoundSettings(saved);
    expect(normalized).toEqual({
      laneScope: "needs_attention_only",
      volume: 0.4,
      triggers: {
        needs_attention_finalized: { enabled: false, soundId: "signal" },
        email_queued: { enabled: true, soundId: "arrival" },
        fyi_finalized: { enabled: true, soundId: "aside" },
        triage_failed: { enabled: false, soundId: "check" },
        event_upcoming: { enabled: true, soundId: "threshold" },
        task_completed: { enabled: true, soundId: "settled" },
        actual_recorded: { enabled: true, soundId: "resolve" },
      },
    });
    expect(normalizeServerSettings(saved)).toEqual(normalized);
  });

  it("updates one trigger without changing the other persisted trigger choices", () => {
    const updated = updateTriageSoundTrigger(
      DEFAULT_TRIAGE_SOUND_SETTINGS,
      "fyi_finalized",
      { enabled: false, soundId: "latch" },
    );

    expect(updated.triggers.fyi_finalized).toEqual({ enabled: false, soundId: "latch" });
    expect(updated.triggers.email_queued).toEqual(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers.email_queued);
    expect(updated.triggers.task_completed).toEqual(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers.task_completed);
  });

  it("clamps persisted volume into the supported range", () => {
    expect(updateTriageSoundVolume(DEFAULT_TRIAGE_SOUND_SETTINGS, "0.55").volume).toBe(0.55);
    expect(updateTriageSoundVolume(DEFAULT_TRIAGE_SOUND_SETTINGS, 2).volume).toBe(1);
    expect(updateTriageSoundVolume(DEFAULT_TRIAGE_SOUND_SETTINGS, -1).volume).toBe(0);
  });
});
