import { useCallback, useEffect, useMemo, useRef } from "react";
import { getSettings } from "@/api";
import {
  resolveDashboardSoundForTrigger,
  resolveTriageSoundForEvent,
  TRIAGE_SOUND_SPACING_MS,
} from "@/lib/triageSoundRouter";
import { createTriageSoundGate } from "@/lib/triageSoundGate";
import type { TriageSoundGate } from "@/lib/triageSoundGate";
import type {
  DashboardSoundTriggerType,
  ResolvedDashboardSound,
  TriageSoundDashboardEvent,
} from "@/lib/triageSoundRouter";
import type { TriageSoundDefinition, TriageSoundSettings } from "@/lib/triageSoundSettings";
import {
  isTriageSoundAudioUnlocked,
  markTriageSoundAudioUnlocked,
  playTriageNotificationSound,
  TRIAGE_SOUND_START_TIMEOUT_MS,
} from "@/lib/triageSoundPlayback";
import type { CurrentDashboardLiveData } from "./currentDashboardModel";

interface QueuedSnapshotItem {
  email_id?: string | number | null;
  uid?: string | number | null;
  id?: string | number | null;
  account_id?: string | number | null;
  read?: boolean | null;
  date?: string | null;
  email_date?: string | null;
}

interface ActiveSnapshotSoundView {
  snapshot?: unknown;
  lanes?: { queued?: QueuedSnapshotItem[] | null } | null;
}

interface CalendarSoundEvent {
  id?: string | number | null;
  title?: string | null;
  startMs?: number | null;
  passed?: boolean;
  allDay?: boolean;
}

interface CalendarSoundSnapshot {
  liveCalendar?: CalendarSoundEvent[] | null;
  lastFetched?: unknown;
}

const CALENDAR_LEAD_TIME_MS = 15 * 60 * 1000;

function queuedSnapshotEventKey(item: QueuedSnapshotItem): string | null {
  const emailId = item?.email_id || item?.uid || item?.id;
  if (!emailId) return null;
  return `email_triage:${item?.account_id || "unknown"}:${emailId}:email_triage_queued`;
}

function calendarUpcomingEventKey(event: CalendarSoundEvent): string {
  return `event_upcoming:${event?.id || event?.title}:${event?.startMs}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

interface PlaybackOptions {
  markUnlocked?: boolean;
  immediate?: boolean;
  eventInfo?: ResolvedDashboardSound | null;
}

interface AppTriggerOptions {
  allowLocked?: boolean;
}

export interface TriageNotificationSoundHandlers {
  handleDashboardEvent: (event: TriageSoundDashboardEvent | null | undefined) => void;
  handleCalendarSnapshot: (liveData: CalendarSoundSnapshot | CurrentDashboardLiveData | null | undefined) => void;
  handleActiveSnapshot: (activeSnapshot: ActiveSnapshotSoundView | null | undefined) => void;
  handleTaskCompleted: (taskId: string | number | null | undefined) => void;
}

export default function useTriageNotificationSounds(): TriageNotificationSoundHandlers {
  const settingsRef = useRef<TriageSoundSettings | null>(null);
  const registryRef = useRef<unknown>(null);
  const gateRef = useRef<TriageSoundGate | null>(null);
  if (gateRef.current === null) gateRef.current = createTriageSoundGate();
  const gate = gateRef.current;
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPlayAtRef = useRef(0);
  const visitStartedAtRef = useRef(Number.POSITIVE_INFINITY);
  const playbackLifetimeRef = useRef(new AbortController());
  const taskCompletionSequenceRef = useRef(0);
  const queuedSnapshotBaselineSeededRef = useRef(false);
  const calendarUpcomingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

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
    const handleStorage = (event: StorageEvent) => {
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

  // Browsers grant audio playback after ANY user gesture in the page (sticky
  // activation). Mirror that: the first pointerdown/keydown unlocks triage
  // sounds instead of waiting for a test play or task completion. Capture
  // phase so a stopPropagation elsewhere cannot swallow the gesture.
  useEffect(() => {
    if (isTriageSoundAudioUnlocked()) return undefined;
    const removeListeners = () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    const unlock = () => {
      markTriageSoundAudioUnlocked();
      removeListeners();
    };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return removeListeners;
  }, []);

  useEffect(() => {
    visitStartedAtRef.current = Date.now();
    playbackLifetimeRef.current = new AbortController();
    let wasHidden = document.visibilityState === "hidden";
    const resumeVisit = () => {
      visitStartedAtRef.current = Date.now();
      playbackLifetimeRef.current.abort();
      playbackLifetimeRef.current = new AbortController();
      playQueueRef.current = Promise.resolve();
      lastPlayAtRef.current = 0;
    };
    const visibilityChanged = () => {
      const hidden = document.visibilityState === "hidden";
      if (wasHidden && !hidden) resumeVisit();
      wasHidden = hidden;
    };
    const pageShown = (event: PageTransitionEvent) => {
      if (event.persisted) resumeVisit();
    };
    const pageHidden = () => playbackLifetimeRef.current.abort();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pageshow", pageShown);
    window.addEventListener("pagehide", pageHidden);
    return () => {
      playbackLifetimeRef.current.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pageshow", pageShown);
      window.removeEventListener("pagehide", pageHidden);
      for (const timerId of calendarUpcomingTimersRef.current) {
        clearTimeout(timerId);
      }
      calendarUpcomingTimersRef.current = [];
    };
  }, []);

  const schedulePlayback = useCallback((sound: TriageSoundDefinition, volume: number, { markUnlocked = false, immediate = false, eventInfo = null }: PlaybackOptions = {}) => {
    const expiresAt = Date.now() + TRIAGE_SOUND_START_TIMEOUT_MS;
    const signal = playbackLifetimeRef.current.signal;
    const play = async () => {
      if (signal.aborted || Date.now() >= expiresAt) return;
      if (!immediate) {
        const waitMs = Math.max(0, lastPlayAtRef.current + TRIAGE_SOUND_SPACING_MS - Date.now());
        if (waitMs > 0) await sleep(waitMs);
      }
      if (signal.aborted || Date.now() >= expiresAt) return;
      const didPlay = await playTriageNotificationSound(sound, { volume, markUnlocked, signal, expiresAt });
      // A prompt rejection can retry, but expired/abandoned work stays seen.
      if (!didPlay && eventInfo && !signal.aborted && Date.now() < expiresAt) gate.forget(eventInfo);
      if (!signal.aborted) lastPlayAtRef.current = Date.now();
    };
    if (immediate) {
      playQueueRef.current = play().catch(() => {});
      return;
    }
    playQueueRef.current = playQueueRef.current.then(play);
  }, [gate]);

  const handleDashboardEvent = useCallback((event: TriageSoundDashboardEvent | null | undefined) => {
    if (!isTriageSoundAudioUnlocked()) return;
    const eventInfo = resolveTriageSoundForEvent(
      event,
      settingsRef.current,
      registryRef.current,
      Date.now(),
      visitStartedAtRef.current,
    );
    if (!eventInfo) return;
    if (!gate.accept(eventInfo)) return;
    schedulePlayback(eventInfo.sound, eventInfo.volume, { eventInfo });
  }, [gate, schedulePlayback]);

  const handleAppTrigger = useCallback((triggerType: DashboardSoundTriggerType, eventKey: string, { allowLocked = false }: AppTriggerOptions = {}) => {
    const unlocked = isTriageSoundAudioUnlocked();
    if (!unlocked && !allowLocked) return;
    const eventInfo = resolveDashboardSoundForTrigger(
      triggerType,
      settingsRef.current,
      registryRef.current,
      eventKey || `${triggerType}:${Date.now()}`,
    );
    if (!eventInfo) return;
    if (!gate.accept(eventInfo)) return;
    schedulePlayback(eventInfo.sound, eventInfo.volume, {
      immediate: allowLocked,
      markUnlocked: allowLocked,
      eventInfo,
    });
  }, [gate, schedulePlayback]);

  const handleCalendarSnapshot = useCallback((liveData: CalendarSoundSnapshot | CurrentDashboardLiveData | null | undefined) => {
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
      (timerId as unknown as { unref?: () => void }).unref?.();
      calendarUpcomingTimersRef.current.push(timerId);
    }
  }, [handleAppTrigger]);

  const handleActiveSnapshot = useCallback((activeSnapshot: ActiveSnapshotSoundView | null | undefined) => {
    if (!activeSnapshot?.snapshot) return;
    const queuedRows = activeSnapshot?.lanes?.queued || [];
    const eventKeys = queuedRows
      .filter((item) => item.read !== true)
      .map(queuedSnapshotEventKey)
      .filter((eventKey): eventKey is string => Boolean(eventKey));
    if (!queuedSnapshotBaselineSeededRef.current) {
      queuedSnapshotBaselineSeededRef.current = true;
      gate.remember(eventKeys);
      return;
    }
    const freshKeys = eventKeys.filter((eventKey) => !gate.has(eventKey));
    for (const row of queuedRows) {
      const eventKey = queuedSnapshotEventKey(row);
      if (!eventKey || gate.has(eventKey)) continue;
      handleDashboardEvent({
        source: "email_triage",
        details: {
          triggerType: "email_queued",
          eventKey,
          emailReceivedAt: row.email_date || row.date,
          read: row.read,
        },
      });
    }
    // Rows that arrived while audio was locked or the trigger was disabled
    // still count as seen; they should not sound on a later snapshot.
    gate.remember(freshKeys);
  }, [gate, handleDashboardEvent]);

  return useMemo(() => ({
    handleDashboardEvent,
    handleCalendarSnapshot,
    handleActiveSnapshot,
    handleTaskCompleted: (taskId: string | number | null | undefined) => {
      taskCompletionSequenceRef.current += 1;
      const occurrenceKey = `${Date.now()}:${taskCompletionSequenceRef.current}`;
      handleAppTrigger("task_completed", `task_completed:${taskId || "unknown"}:${occurrenceKey}`, { allowLocked: true });
    },
  }), [handleActiveSnapshot, handleAppTrigger, handleCalendarSnapshot, handleDashboardEvent]);
}
