import { useCallback, useEffect, useMemo, useRef } from "react";
import { getSettings } from "@/api";
import {
  resolveDashboardSoundForTrigger,
  resolveTriageSoundForEvent,
  shouldAcceptTriageSoundEvent,
  TRIAGE_SOUND_SPACING_MS,
} from "@/lib/triageSoundRouter";
import {
  isTriageSoundAudioUnlocked,
  playTriageNotificationSound,
} from "@/lib/triageSoundPlayback";

const DEDUPE_STORAGE_KEY = "ea_triage_sound_event_keys";
const MAX_DEDUPE_KEYS = 200;
const CALENDAR_LEAD_TIME_MS = 15 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function readDedupeKeys() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DEDUPE_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeDedupeKeys(keys) {
  try {
    const recent = Array.from(keys).slice(-MAX_DEDUPE_KEYS);
    sessionStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Storage failure should never block dashboard updates.
  }
}

export default function useTriageNotificationSounds() {
  const settingsRef = useRef(null);
  const registryRef = useRef(null);
  const gateRef = useRef({ dedupeKeys: readDedupeKeys(), lastTriggerAt: {} });
  const playQueueRef = useRef(Promise.resolve());
  const lastPlayAtRef = useRef(0);

  const loadSettings = useCallback(() => {
    getSettings()
      .then((settings) => {
        settingsRef.current = settings?.triage_sound_settings || null;
        registryRef.current = settings?.triage_notification_sounds || null;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSettings();
    const handleStorage = (event) => {
      if (event.key === "ea_settings_changed") loadSettings();
    };
    const handleSettingsChanged = () => loadSettings();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("ea-settings-changed", handleSettingsChanged);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("ea-settings-changed", handleSettingsChanged);
    };
  }, [loadSettings]);

  const schedulePlayback = useCallback((sound, volume) => {
    playQueueRef.current = playQueueRef.current.then(async () => {
      const waitMs = Math.max(0, lastPlayAtRef.current + TRIAGE_SOUND_SPACING_MS - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      await playTriageNotificationSound(sound, { volume });
      lastPlayAtRef.current = Date.now();
    });
  }, []);

  const handleDashboardEvent = useCallback((event) => {
    if (!isTriageSoundAudioUnlocked()) return;
    const eventInfo = resolveTriageSoundForEvent(
      event,
      settingsRef.current,
      registryRef.current,
    );
    if (!eventInfo) return;
    const beforeDedupeSize = gateRef.current.dedupeKeys.size;
    const accepted = shouldAcceptTriageSoundEvent(eventInfo, gateRef.current);
    if (gateRef.current.dedupeKeys.size !== beforeDedupeSize) {
      writeDedupeKeys(gateRef.current.dedupeKeys);
    }
    if (!accepted) return;
    schedulePlayback(eventInfo.sound, eventInfo.volume);
  }, [schedulePlayback]);

  const handleAppTrigger = useCallback((triggerType, eventKey, { coalesce = false } = {}) => {
    if (!isTriageSoundAudioUnlocked()) return;
    const eventInfo = resolveDashboardSoundForTrigger(
      triggerType,
      settingsRef.current,
      registryRef.current,
      eventKey || `${triggerType}:${Date.now()}`,
    );
    if (!eventInfo) return;
    if (coalesce) {
      const beforeDedupeSize = gateRef.current.dedupeKeys.size;
      const accepted = shouldAcceptTriageSoundEvent(eventInfo, gateRef.current);
      if (gateRef.current.dedupeKeys.size !== beforeDedupeSize) {
        writeDedupeKeys(gateRef.current.dedupeKeys);
      }
      if (!accepted) return;
    } else if (eventInfo.eventKey) {
      if (gateRef.current.dedupeKeys.has(eventInfo.eventKey)) return;
      gateRef.current.dedupeKeys.add(eventInfo.eventKey);
      writeDedupeKeys(gateRef.current.dedupeKeys);
    }
    schedulePlayback(eventInfo.sound, eventInfo.volume);
  }, [schedulePlayback]);

  const handleCalendarSnapshot = useCallback((liveData) => {
    const { liveCalendar, lastFetched } = liveData || {};
    if (!lastFetched) return;
    const now = Date.now();
    for (const event of liveCalendar || []) {
      if (event.passed || event.allDay || !event.startMs) continue;
      const timeUntil = event.startMs - now;
      if (timeUntil > 0 && timeUntil <= CALENDAR_LEAD_TIME_MS) {
        const eventKey = `event_upcoming:${event.id || event.title}:${event.startMs}`;
        handleAppTrigger("event_upcoming", eventKey, { coalesce: true });
      }
    }
  }, [handleAppTrigger]);

  return useMemo(() => ({
    handleDashboardEvent,
    handleCalendarSnapshot,
    handleTaskCompleted: (taskId) => handleAppTrigger("task_completed", `task_completed:${taskId || Date.now()}`),
  }), [handleAppTrigger, handleCalendarSnapshot, handleDashboardEvent]);
}
