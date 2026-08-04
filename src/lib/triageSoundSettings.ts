import triageNotificationSounds from "../../shared/triage-notification-sounds.json";

export const TRIAGE_SOUND_LANE_SCOPES = {
  NEEDS_ATTENTION_ONLY: "needs_attention_only",
  NEEDS_ATTENTION_AND_FYI: "needs_attention_and_fyi",
} as const;

export type TriageSoundLaneScope = (typeof TRIAGE_SOUND_LANE_SCOPES)[keyof typeof TRIAGE_SOUND_LANE_SCOPES];

export const TRIAGE_SOUND_TRIGGER_KEYS = {
  NEEDS_ATTENTION_FINALIZED: "needs_attention_finalized",
  EMAIL_QUEUED: "email_queued",
  FYI_FINALIZED: "fyi_finalized",
  WEAK_SECURITY_GRACE: "weak_security_grace",
  TRIAGE_FAILED: "triage_failed",
  EVENT_UPCOMING: "event_upcoming",
  TASK_COMPLETED: "task_completed",
} as const;

export type TriageSoundTriggerKey = (typeof TRIAGE_SOUND_TRIGGER_KEYS)[keyof typeof TRIAGE_SOUND_TRIGGER_KEYS];

export interface TriageSoundDefinition {
  id: string;
  path: string;
  label?: string;
  [key: string]: unknown;
}

export interface TriageSoundTriggerSetting {
  enabled: boolean;
  soundId: string;
}

export interface TriageSoundSettings {
  laneScope: TriageSoundLaneScope;
  volume: number;
  triggers: Record<TriageSoundTriggerKey, TriageSoundTriggerSetting>;
}

export const DEFAULT_TRIAGE_NOTIFICATION_SOUNDS = triageNotificationSounds satisfies TriageSoundDefinition[];
const DEFAULT_SOUND_IDS = new Set(DEFAULT_TRIAGE_NOTIFICATION_SOUNDS.map((sound) => sound.id));

export const DEFAULT_TRIAGE_SOUND_SETTINGS = {
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
} satisfies TriageSoundSettings;

export const TRIAGE_SOUND_TRIGGER_ROWS = [
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.NEEDS_ATTENTION_FINALIZED,
    label: "Needs attention finalized",
    description: "Mail that lands in the action lane.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.EMAIL_QUEUED,
    label: "Queued mail",
    description: "Fresh mail waiting through the 3-minute triage window.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.FYI_FINALIZED,
    label: "FYI finalized",
    description: "Informational mail that should still be noticed.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.WEAK_SECURITY_GRACE,
    label: "Weak-security grace",
    description: "Security mail waiting through the grace window.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.TRIAGE_FAILED,
    label: "Triage failed",
    description: "Fallback review when classification errors.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.EVENT_UPCOMING,
    label: "Upcoming event",
    description: "Calendar events entering the 15-minute window.",
  },
  {
    key: TRIAGE_SOUND_TRIGGER_KEYS.TASK_COMPLETED,
    label: "Task completed",
    description: "Todoist-backed deadlines marked complete from the dashboard.",
  },
] as const;

function cloneDefaultSettings(): TriageSoundSettings {
  return {
    laneScope: DEFAULT_TRIAGE_SOUND_SETTINGS.laneScope,
    volume: DEFAULT_TRIAGE_SOUND_SETTINGS.volume,
    triggers: Object.fromEntries(
      Object.entries(DEFAULT_TRIAGE_SOUND_SETTINGS.triggers).map(([key, value]) => [
        key,
        { ...value },
      ]),
    ) as Record<TriageSoundTriggerKey, TriageSoundTriggerSetting>,
  };
}

export function normalizeTriageSoundSettings(value: unknown): TriageSoundSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const next = cloneDefaultSettings();
  if (Object.values(TRIAGE_SOUND_LANE_SCOPES).some((scope) => scope === source.laneScope)) {
    next.laneScope = source.laneScope as TriageSoundLaneScope;
  }
  const volume = Number(source.volume);
  if (Number.isFinite(volume)) {
    next.volume = Math.min(1, Math.max(0, volume));
  }
  const sourceTriggers = source.triggers && typeof source.triggers === "object" && !Array.isArray(source.triggers)
    ? source.triggers as Record<string, unknown>
    : {};
  for (const row of TRIAGE_SOUND_TRIGGER_ROWS) {
    const sourceRow = sourceTriggers[row.key];
    if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) continue;
    const sourceTrigger = sourceRow as Record<string, unknown>;
    if (typeof sourceTrigger.enabled === "boolean") {
      next.triggers[row.key].enabled = sourceTrigger.enabled;
    }
    if (typeof sourceTrigger.soundId === "string" && DEFAULT_SOUND_IDS.has(sourceTrigger.soundId)) {
      next.triggers[row.key].soundId = sourceTrigger.soundId;
    }
  }
  return next;
}

export function updateTriageSoundTrigger(
  settings: TriageSoundSettings,
  triggerKey: TriageSoundTriggerKey,
  updates: Partial<TriageSoundTriggerSetting>,
): TriageSoundSettings {
  return {
    ...settings,
    triggers: {
      ...settings.triggers,
      [triggerKey]: { ...settings.triggers[triggerKey], ...updates },
    },
  };
}

export function updateTriageSoundVolume(
  settings: TriageSoundSettings,
  value: string | number,
): TriageSoundSettings {
  const volume = Math.min(1, Math.max(0, Number(value)));
  return { ...settings, volume: Number.isFinite(volume) ? volume : 1 };
}

export function resolveTriageSoundRegistry(value: unknown): TriageSoundDefinition[] {
  return Array.isArray(value) && value.length > 0
    ? value as TriageSoundDefinition[]
    : DEFAULT_TRIAGE_NOTIFICATION_SOUNDS;
}
