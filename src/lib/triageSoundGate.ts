// Single dedup + coalesce gate for every triage-sound publisher (SSE
// dashboard events, snapshot diffing, calendar timers, completion gestures).
// All publishers share one event-key set — mirrored to sessionStorage so
// reloads within a session stay quiet — and one per-trigger coalesce window.
export const TRIAGE_SOUND_COALESCE_MS = 4_000;

const DEDUPE_STORAGE_KEY = "ea_triage_sound_event_keys";
const MAX_DEDUPE_KEYS = 200;

// Coalescing collapses a burst of the same trigger type into one sound.
// Triggers fired directly by a user gesture opt out: every action the user
// takes should be audible.
const NON_COALESCED_TRIGGERS = new Set(["task_completed"]);

export interface TriageSoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TriageSoundEventInfo {
  eventKey?: string | null;
  triggerType?: string | null;
}

export interface TriageSoundGate {
  has(eventKey: string): boolean;
  remember(eventKeys: Iterable<string | null | undefined>): void;
  forget(eventInfo: TriageSoundEventInfo | null | undefined): void;
  accept(eventInfo: TriageSoundEventInfo | null | undefined, now?: number): boolean;
}

function readStoredKeys(storage: TriageSoundStorage): Set<string> {
  try {
    return new Set(JSON.parse(storage.getItem(DEDUPE_STORAGE_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function createTriageSoundGate(
  { storage }: { storage?: TriageSoundStorage } = {},
): TriageSoundGate {
  const store = storage || globalThis.sessionStorage;
  const dedupeKeys = readStoredKeys(store);
  const lastTriggerAt: Record<string, number> = {};

  function persist() {
    try {
      store.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(Array.from(dedupeKeys).slice(-MAX_DEDUPE_KEYS)));
    } catch {
      // Storage failure should never block dashboard updates.
    }
  }

  return {
    has(eventKey: string) {
      return dedupeKeys.has(eventKey);
    },
    // Record keys as seen without playing — e.g. queued rows present on the
    // initial snapshot load should never sound later.
    remember(eventKeys: Iterable<string | null | undefined>) {
      let added = false;
      for (const eventKey of eventKeys) {
        if (!eventKey || dedupeKeys.has(eventKey)) continue;
        dedupeKeys.add(eventKey);
        added = true;
      }
      if (added) persist();
    },
    // Release a key that was accepted but whose playback failed (autoplay
    // block, suspended context). The failed play made no sound, so the next
    // offer of the same event should pass both the dedupe set and the
    // coalesce window.
    forget(eventInfo: TriageSoundEventInfo | null | undefined) {
      if (!eventInfo?.eventKey || !dedupeKeys.has(eventInfo.eventKey)) return;
      dedupeKeys.delete(eventInfo.eventKey);
      persist();
      if (eventInfo.triggerType) lastTriggerAt[eventInfo.triggerType] = 0;
    },
    accept(eventInfo: TriageSoundEventInfo | null | undefined, now = Date.now()) {
      if (!eventInfo?.eventKey || !eventInfo?.triggerType) return false;
      if (dedupeKeys.has(eventInfo.eventKey)) return false;
      dedupeKeys.add(eventInfo.eventKey);
      persist();
      if (!NON_COALESCED_TRIGGERS.has(eventInfo.triggerType)) {
        const last = lastTriggerAt[eventInfo.triggerType] || 0;
        if (now - last < TRIAGE_SOUND_COALESCE_MS) return false;
        lastTriggerAt[eventInfo.triggerType] = now;
      }
      return true;
    },
  };
}
