import { useCallback, useEffect, useMemo, useRef } from "react";
import { getSettings } from "@/api";
import {
  resolveDashboardSoundForTrigger,
  resolveTriageSoundForEvent,
  TRIAGE_SOUND_SPACING_MS,
} from "@/lib/triageSoundRouter";
import { createTriageSoundGate } from "@/lib/triageSoundGate";
import {
  isTriageSoundAudioUnlocked,
  playTriageNotificationSound,
} from "@/lib/triageSoundPlayback";

const CALENDAR_LEAD_TIME_MS = 15 * 60 * 1000;

function queuedSnapshotEventKey(item) {
  const emailId = item?.email_id || item?.uid || item?.id;
  if (!emailId) return null;
  return `email_triage:${item?.account_id || "unknown"}:${emailId}:email_triage_queued`;
}

function calendarUpcomingEventKey(event) {
  return `event_upcoming:${event?.id || event?.title}:${event?.startMs}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export default function useTriageNotificationSounds() {
  const settingsRef = useRef(null);
  const registryRef = useRef(null);
  const gateRef = useRef(null);
  if (gateRef.current === null) gateRef.current = createTriageSoundGate();
  const playQueueRef = useRef(Promise.resolve());
  const lastPlayAtRef = useRef(0);
  const taskCompletionSequenceRef = useRef(0);
  const queuedSnapshotBaselineSeededRef = useRef(false);
  const calendarUpcomingTimersRef = useRef([]);

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

  useEffect(() => () => {
    for (const timerId of calendarUpcomingTimersRef.current) {
      clearTimeout(timerId);
    }
    calendarUpcomingTimersRef.current = [];
  }, []);

  const schedulePlayback = useCallback((sound, volume, { markUnlocked = false, immediate = false } = {}) => {
    const play = async () => {
      if (!immediate) {
        const waitMs = Math.max(0, lastPlayAtRef.current + TRIAGE_SOUND_SPACING_MS - Date.now());
        if (waitMs > 0) await sleep(waitMs);
      }
      await playTriageNotificationSound(sound, { volume, markUnlocked });
      lastPlayAtRef.current = Date.now();
    };
    if (immediate) {
      playQueueRef.current = play().catch(() => {});
      return;
    }
    playQueueRef.current = playQueueRef.current.then(play);
  }, []);

  const handleDashboardEvent = useCallback((event) => {
    if (!isTriageSoundAudioUnlocked()) return;
    const eventInfo = resolveTriageSoundForEvent(
      event,
      settingsRef.current,
      registryRef.current,
    );
    if (!eventInfo) return;
    if (!gateRef.current.accept(eventInfo)) return;
    schedulePlayback(eventInfo.sound, eventInfo.volume);
  }, [schedulePlayback]);

  const handleAppTrigger = useCallback((triggerType, eventKey, { allowLocked = false } = {}) => {
    const unlocked = isTriageSoundAudioUnlocked();
    if (!unlocked && !allowLocked) return;
    const eventInfo = resolveDashboardSoundForTrigger(
      triggerType,
      settingsRef.current,
      registryRef.current,
      eventKey || `${triggerType}:${Date.now()}`,
    );
    if (!eventInfo) return;
    if (!gateRef.current.accept(eventInfo)) return;
    schedulePlayback(eventInfo.sound, eventInfo.volume, {
      immediate: allowLocked,
      markUnlocked: allowLocked,
    });
  }, [schedulePlayback]);

  const handleCalendarSnapshot = useCallback((liveData) => {
    const { liveCalendar, lastFetched } = liveData || {};
    if (!lastFetched) return;
    const now = Date.now();
    for (const timerId of calendarUpcomingTimersRef.current) {
      clearTimeout(timerId);
    }
    calendarUpcomingTimersRef.current = [];
    for (const event of liveCalendar || []) {
      if (event.passed || event.allDay || !event.startMs) continue;
      const timeUntil = event.startMs - now;
      if (timeUntil <= 0) continue;
      const eventKey = calendarUpcomingEventKey(event);
      if (timeUntil > 0 && timeUntil <= CALENDAR_LEAD_TIME_MS) {
        handleAppTrigger("event_upcoming", eventKey);
        continue;
      }
      const timerId = setTimeout(() => {
        handleAppTrigger("event_upcoming", eventKey);
      }, timeUntil - CALENDAR_LEAD_TIME_MS);
      timerId.unref?.();
      calendarUpcomingTimersRef.current.push(timerId);
    }
  }, [handleAppTrigger]);

  const handleActiveSnapshot = useCallback((activeSnapshot) => {
    if (!activeSnapshot?.snapshot) return;
    const queuedRows = activeSnapshot?.lanes?.queued || [];
    const eventKeys = queuedRows
      .map(queuedSnapshotEventKey)
      .filter(Boolean);
    if (!queuedSnapshotBaselineSeededRef.current) {
      queuedSnapshotBaselineSeededRef.current = true;
      gateRef.current.remember(eventKeys);
      return;
    }
    const freshKeys = eventKeys.filter((eventKey) => !gateRef.current.has(eventKey));
    for (const eventKey of freshKeys) {
      handleAppTrigger("email_queued", eventKey);
    }
    // Rows that arrived while audio was locked or the trigger was disabled
    // still count as seen; they should not sound on a later snapshot.
    gateRef.current.remember(freshKeys);
  }, [handleAppTrigger]);

  return useMemo(() => ({
    handleDashboardEvent,
    handleCalendarSnapshot,
    handleActiveSnapshot,
    handleTaskCompleted: (taskId) => {
      taskCompletionSequenceRef.current += 1;
      const occurrenceKey = `${Date.now()}:${taskCompletionSequenceRef.current}`;
      handleAppTrigger("task_completed", `task_completed:${taskId || "unknown"}:${occurrenceKey}`, { allowLocked: true });
    },
  }), [handleActiveSnapshot, handleAppTrigger, handleCalendarSnapshot, handleDashboardEvent]);
}
