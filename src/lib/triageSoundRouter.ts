import {
  normalizeTriageSoundSettings,
  resolveTriageSoundRegistry,
  TRIAGE_SOUND_TRIGGER_KEYS,
} from "@/lib/triageSoundSettings";
import type {
  TriageSoundDefinition,
  TriageSoundTriggerKey,
} from "@/lib/triageSoundSettings";

export const TRIAGE_SOUND_SPACING_MS = 650;
export const EMAIL_TRIAGE_SOUND_FRESHNESS_MS = 5 * 60 * 1000;

const TRIGGER_TO_SETTING_KEY = {
  needs_attention_finalized: TRIAGE_SOUND_TRIGGER_KEYS.NEEDS_ATTENTION_FINALIZED,
  email_queued: TRIAGE_SOUND_TRIGGER_KEYS.EMAIL_QUEUED,
  fyi_finalized: TRIAGE_SOUND_TRIGGER_KEYS.FYI_FINALIZED,
  weak_security_grace: TRIAGE_SOUND_TRIGGER_KEYS.WEAK_SECURITY_GRACE,
  triage_failed: TRIAGE_SOUND_TRIGGER_KEYS.TRIAGE_FAILED,
  event_upcoming: TRIAGE_SOUND_TRIGGER_KEYS.EVENT_UPCOMING,
  task_completed: TRIAGE_SOUND_TRIGGER_KEYS.TASK_COMPLETED,
} as const satisfies Record<string, TriageSoundTriggerKey>;

export type DashboardSoundTriggerType = keyof typeof TRIGGER_TO_SETTING_KEY;

export interface ResolvedDashboardSound {
  eventKey: string;
  triggerType: DashboardSoundTriggerType;
  sound: TriageSoundDefinition;
  volume: number;
}

export interface TriageSoundDashboardEvent {
  source?: unknown;
  occurredAt?: unknown;
  details?: {
    triggerType?: unknown;
    eventKey?: unknown;
    emailId?: unknown;
    emailReceivedAt?: unknown;
    reason?: unknown;
    read?: unknown;
  } | null;
}

function triageSoundReferenceTime(event: TriageSoundDashboardEvent): number {
  const referenceAt = event.details?.emailReceivedAt ?? event.occurredAt;
  if (typeof referenceAt !== "string" && typeof referenceAt !== "number") return Number.NaN;
  return Date.parse(String(referenceAt));
}

export function resolveDashboardSoundForTrigger(
  triggerType: string,
  settings: unknown,
  registry: unknown,
  eventKey = triggerType,
): ResolvedDashboardSound | null {
  const triggerKey = (TRIGGER_TO_SETTING_KEY as Readonly<Record<string, TriageSoundTriggerKey>>)[triggerType];
  if (!triggerKey) return null;

  const soundSettings = normalizeTriageSoundSettings(settings);
  if (
    triggerKey === TRIAGE_SOUND_TRIGGER_KEYS.FYI_FINALIZED
    && soundSettings.laneScope === "needs_attention_only"
  ) {
    return null;
  }

  const triggerSettings = soundSettings.triggers[triggerKey];
  if (!triggerSettings?.enabled) return null;

  const sounds = resolveTriageSoundRegistry(registry);
  const sound = sounds.find((entry) => entry.id === triggerSettings.soundId) || sounds[0];
  if (!sound) return null;

  return {
    eventKey,
    triggerType: triggerType as DashboardSoundTriggerType,
    sound,
    volume: soundSettings.volume,
  };
}

export function resolveTriageSoundForEvent(
  event: TriageSoundDashboardEvent | null | undefined,
  settings: unknown,
  registry: unknown,
  now = Date.now(),
): ResolvedDashboardSound | null {
  const details = event?.details;
  if (event?.source !== "email_triage" || typeof details?.triggerType !== "string") return null;
  if (details.read === true) return null;
  const referenceTime = triageSoundReferenceTime(event);
  if (!Number.isFinite(referenceTime) || now - referenceTime > EMAIL_TRIAGE_SOUND_FRESHNESS_MS) return null;
  return resolveDashboardSoundForTrigger(
    details.triggerType,
    settings,
    registry,
    (details.eventKey
      || `${String(details.emailId || "unknown")}:${String(details.reason || details.triggerType)}`) as string,
  );
}
