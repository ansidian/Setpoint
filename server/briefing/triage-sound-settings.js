import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TRIAGE_SOUND_LANE_SCOPES = {
  NEEDS_ATTENTION_ONLY: "needs_attention_only",
  NEEDS_ATTENTION_AND_FYI: "needs_attention_and_fyi",
};

export const TRIAGE_SOUND_TRIGGER_KEYS = {
  NEEDS_ATTENTION_FINALIZED: "needs_attention_finalized",
  FYI_FINALIZED: "fyi_finalized",
  WEAK_SECURITY_GRACE: "weak_security_grace",
  TRIAGE_FAILED: "triage_failed",
  EVENT_UPCOMING: "event_upcoming",
  TASK_COMPLETED: "task_completed",
};

export const TRIAGE_NOTIFICATION_SOUNDS = JSON.parse(
  readFileSync(join(__dirname, "../../shared/triage-notification-sounds.json"), "utf8"),
);

const SOUND_IDS = new Set(TRIAGE_NOTIFICATION_SOUNDS.map((sound) => sound.id));
const TRIGGER_KEYS = new Set(Object.values(TRIAGE_SOUND_TRIGGER_KEYS));
const LANE_SCOPES = new Set(Object.values(TRIAGE_SOUND_LANE_SCOPES));

export const DEFAULT_TRIAGE_SOUND_SETTINGS = {
  laneScope: TRIAGE_SOUND_LANE_SCOPES.NEEDS_ATTENTION_AND_FYI,
  volume: 1,
  triggers: {
    [TRIAGE_SOUND_TRIGGER_KEYS.NEEDS_ATTENTION_FINALIZED]: {
      enabled: true,
      soundId: "clear_chime",
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

function cloneDefaultSettings() {
  return {
    laneScope: DEFAULT_TRIAGE_SOUND_SETTINGS.laneScope,
    volume: DEFAULT_TRIAGE_SOUND_SETTINGS.volume,
    triggers: Object.fromEntries(
      Object.entries(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers).map(([key, value]) => [
        key,
        { ...value },
      ]),
    ),
  };
}

export function normalizeTriageSoundSettings(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const next = cloneDefaultSettings();
  if (LANE_SCOPES.has(source.laneScope)) {
    next.laneScope = source.laneScope;
  }
  const volume = Number(source.volume);
  if (Number.isFinite(volume)) {
    next.volume = Math.min(1, Math.max(0, volume));
  }
  const sourceTriggers = source.triggers && typeof source.triggers === "object" && !Array.isArray(source.triggers)
    ? source.triggers
    : {};
  for (const key of TRIGGER_KEYS) {
    const row = sourceTriggers[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.enabled === "boolean") {
      next.triggers[key].enabled = row.enabled;
    }
    if (SOUND_IDS.has(row.soundId)) {
      next.triggers[key].soundId = row.soundId;
    }
  }
  return next;
}

export function parseTriageSoundSettingsJson(json) {
  if (!json) return normalizeTriageSoundSettings();
  try {
    return normalizeTriageSoundSettings(JSON.parse(json));
  } catch {
    return normalizeTriageSoundSettings();
  }
}

export function validateTriageSoundSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: "Invalid triage_sound_settings" };
  }
  if (!LANE_SCOPES.has(value.laneScope)) {
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
  if (!value.triggers || typeof value.triggers !== "object" || Array.isArray(value.triggers)) {
    return { valid: false, message: "Invalid triage_sound_settings triggers" };
  }
  for (const key of Object.keys(value.triggers)) {
    if (!TRIGGER_KEYS.has(key)) {
      return { valid: false, message: "Invalid triage_sound_settings trigger" };
    }
    const row = value.triggers[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { valid: false, message: "Invalid triage_sound_settings trigger row" };
    }
    if (typeof row.enabled !== "boolean") {
      return { valid: false, message: "Invalid triage_sound_settings enabled" };
    }
    if (!SOUND_IDS.has(row.soundId)) {
      return { valid: false, message: "Invalid triage_sound_settings soundId" };
    }
  }
  return { valid: true };
}
