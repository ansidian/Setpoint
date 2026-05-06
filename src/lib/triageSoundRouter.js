import {
  normalizeTriageSoundSettings,
  resolveTriageSoundRegistry,
  TRIAGE_SOUND_TRIGGER_KEYS,
} from "@/lib/triageSoundSettings";

export const TRIAGE_SOUND_COALESCE_MS = 4_000;
export const TRIAGE_SOUND_SPACING_MS = 650;

const TRIGGER_TO_SETTING_KEY = {
  needs_attention_finalized: TRIAGE_SOUND_TRIGGER_KEYS.NEEDS_ATTENTION_FINALIZED,
  fyi_finalized: TRIAGE_SOUND_TRIGGER_KEYS.FYI_FINALIZED,
  weak_security_grace: TRIAGE_SOUND_TRIGGER_KEYS.WEAK_SECURITY_GRACE,
  triage_failed: TRIAGE_SOUND_TRIGGER_KEYS.TRIAGE_FAILED,
  event_upcoming: TRIAGE_SOUND_TRIGGER_KEYS.EVENT_UPCOMING,
  task_completed: TRIAGE_SOUND_TRIGGER_KEYS.TASK_COMPLETED,
};

export function resolveDashboardSoundForTrigger(triggerType, settings, registry, eventKey = triggerType) {
  const triggerKey = TRIGGER_TO_SETTING_KEY[triggerType];
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
    triggerType,
    sound,
    volume: soundSettings.volume,
  };
}

export function resolveTriageSoundForEvent(event, settings, registry) {
  const details = event?.details;
  if (event?.source !== "email_triage" || !details?.triggerType) return null;
  return resolveDashboardSoundForTrigger(
    details.triggerType,
    settings,
    registry,
    details.eventKey || `${details.emailId || "unknown"}:${details.reason || details.triggerType}`,
  );
}

export function shouldAcceptTriageSoundEvent(eventInfo, gate, now = Date.now()) {
  if (!eventInfo?.eventKey || !eventInfo?.triggerType) return false;
  if (gate.dedupeKeys.has(eventInfo.eventKey)) return false;
  const lastTriggerAt = gate.lastTriggerAt[eventInfo.triggerType] || 0;
  if (now - lastTriggerAt < TRIAGE_SOUND_COALESCE_MS) {
    gate.dedupeKeys.add(eventInfo.eventKey);
    return false;
  }
  gate.dedupeKeys.add(eventInfo.eventKey);
  gate.lastTriggerAt[eventInfo.triggerType] = now;
  return true;
}
