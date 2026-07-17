import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sharedRegistry from "../../shared/triage-notification-sounds.json";
import {
  DEFAULT_TRIAGE_SOUND_SETTINGS as SERVER_DEFAULT_TRIAGE_SOUND_SETTINGS,
  TRIAGE_NOTIFICATION_SOUNDS,
} from "../../server/triage/triage-sound-settings.ts";
import {
  DEFAULT_TRIAGE_NOTIFICATION_SOUNDS,
  DEFAULT_TRIAGE_SOUND_SETTINGS,
  normalizeTriageSoundSettings,
} from "./triageSoundSettings";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("triage sound settings registry", () => {
  it("uses the shared notification sound registry on the server and client", () => {
    expect(DEFAULT_TRIAGE_NOTIFICATION_SOUNDS).toEqual(sharedRegistry);
    expect(TRIAGE_NOTIFICATION_SOUNDS).toEqual(sharedRegistry);
  });

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

  it("normalizes stale trigger sound IDs back to valid defaults", () => {
    const normalized = normalizeTriageSoundSettings({
      triggers: {
        fyi_finalized: { enabled: true, soundId: "soft_ping" },
        task_completed: { enabled: true, soundId: "soft_ping" },
      },
    });

    expect(normalized.triggers.fyi_finalized.soundId).toBe("smooth_modern");
    expect(normalized.triggers.task_completed.soundId).toBe("smooth_modern");
  });
});
