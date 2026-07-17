import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type {
  TriageNotificationSound,
  TriageSoundLaneScope,
  TriageSoundSettings,
  TriageSoundTriggerKey,
} from "../../shared/types/settings.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TRIAGE_SOUND_LANE_SCOPES = {
  NEEDS_ATTENTION_ONLY: "needs_attention_only",
  NEEDS_ATTENTION_AND_FYI: "needs_attention_and_fyi",
} as const;

export const TRIAGE_SOUND_TRIGGER_KEYS = {
  NEEDS_ATTENTION_FINALIZED: "needs_attention_finalized",
  EMAIL_QUEUED: "email_queued",
  FYI_FINALIZED: "fyi_finalized",
  WEAK_SECURITY_GRACE: "weak_security_grace",
  TRIAGE_FAILED: "triage_failed",
  EVENT_UPCOMING: "event_upcoming",
  TASK_COMPLETED: "task_completed",
} as const;

export const TRIAGE_NOTIFICATION_SOUNDS = JSON.parse(
  readFileSync(join(__dirname, "../../shared/triage-notification-sounds.json"), "utf8"),
) as TriageNotificationSound[];

const SOUND_IDS = new Set(TRIAGE_NOTIFICATION_SOUNDS.map((sound) => sound.id));
const TRIGGER_KEYS = new Set<TriageSoundTriggerKey>(Object.values(TRIAGE_SOUND_TRIGGER_KEYS));
const LANE_SCOPES = new Set<TriageSoundLaneScope>(Object.values(TRIAGE_SOUND_LANE_SCOPES));

export const DEFAULT_TRIAGE_SOUND_SETTINGS: TriageSoundSettings = {
  laneScope: TRIAGE_SOUND_LANE_SCOPES.NEEDS_ATTENTION_AND_FYI,
  volume: 1,
  triggers: {
    [TRIAGE_SOUND_TRIGGER_KEYS.NEEDS_ATTENTION_FINALIZED]: {
      enabled: true,
      soundId: "clear_chime",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.EMAIL_QUEUED]: {
      enabled: true,
      soundId: "quick_chime",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.FYI_FINALIZED]: {
      enabled: true,
      soundId: "smooth_modern",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.WEAK_SECURITY_GRACE]: {
      enabled: true,
      soundId: "low_tone",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.TRIAGE_FAILED]: {
      enabled: false,
      soundId: "low_tone",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.EVENT_UPCOMING]: {
      enabled: true,
      soundId: "clear_chime",
    },
    [TRIAGE_SOUND_TRIGGER_KEYS.TASK_COMPLETED]: {
      enabled: true,
      soundId: "smooth_modern",
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneDefaultSettings(): TriageSoundSettings {
  return {
    laneScope: DEFAULT_TRIAGE_SOUND_SETTINGS.laneScope,
    volume: DEFAULT_TRIAGE_SOUND_SETTINGS.volume,
    triggers: Object.fromEntries(
      Object.entries(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers).map(([key, value]) => [
        key,
        { ...value },
      ]),
    ) as TriageSoundSettings["triggers"],
  };
}

export function normalizeTriageSoundSettings(value: unknown = null): TriageSoundSettings {
  const source: Record<string, unknown> = isRecord(value)
    ? value
    : {};
  const next = cloneDefaultSettings();
  if (typeof source.laneScope === "string" && LANE_SCOPES.has(source.laneScope as TriageSoundLaneScope)) {
    next.laneScope = source.laneScope as TriageSoundLaneScope;
  }
  const volume = Number(source.volume);
  if (Number.isFinite(volume)) {
    next.volume = Math.min(1, Math.max(0, volume));
  }
  const sourceTriggers = isRecord(source.triggers)
    ? source.triggers
    : {};
  for (const key of TRIGGER_KEYS) {
    const row = sourceTriggers[key];
    if (!isRecord(row)) continue;
    if (typeof row.enabled === "boolean") {
      next.triggers[key].enabled = row.enabled;
    }
    if (typeof row.soundId === "string" && SOUND_IDS.has(row.soundId)) {
      next.triggers[key].soundId = row.soundId;
    }
  }
  return next;
}

export function parseTriageSoundSettingsJson(json: unknown): TriageSoundSettings {
  if (!json) return normalizeTriageSoundSettings();
  try {
    return normalizeTriageSoundSettings(JSON.parse(String(json)) as unknown);
  } catch {
    return normalizeTriageSoundSettings();
  }
}

export function validateTriageSoundSettings(value: unknown): { valid: boolean; message?: string } {
  if (!isRecord(value)) {
    return { valid: false, message: "Invalid triage_sound_settings" };
  }
  if (typeof value.laneScope !== "string" || !LANE_SCOPES.has(value.laneScope as TriageSoundLaneScope)) {
    return { valid: false, message: "Invalid triage_sound_settings laneScope" };
  }
  if (
    value.volume !== undefined
    && (
      typeof value.volume !== "number"
      || !Number.isFinite(value.volume)
      || value.volume < 0
      || value.volume > 1
    )
  ) {
    return { valid: false, message: "Invalid triage_sound_settings volume" };
  }
  if (!isRecord(value.triggers)) {
    return { valid: false, message: "Invalid triage_sound_settings triggers" };
  }
  for (const key of Object.keys(value.triggers)) {
    if (!TRIGGER_KEYS.has(key as TriageSoundTriggerKey)) {
      return { valid: false, message: "Invalid triage_sound_settings trigger" };
    }
    const row = value.triggers[key];
    if (!isRecord(row)) {
      return { valid: false, message: "Invalid triage_sound_settings trigger row" };
    }
    if (typeof row.enabled !== "boolean") {
      return { valid: false, message: "Invalid triage_sound_settings enabled" };
    }
    if (typeof row.soundId !== "string" || !SOUND_IDS.has(row.soundId)) {
      return { valid: false, message: "Invalid triage_sound_settings soundId" };
    }
  }
  return { valid: true };
}
