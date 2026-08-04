import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIAGE_SOUND_AUDIO_UNLOCK_KEY } from "@/lib/triageSoundPlayback";
import useTriageNotificationSounds from "./useTriageNotificationSounds";

let settingsRequestCount = 0;

const settings = {
  triage_sound_settings: {
    laneScope: "needs_attention_and_fyi",
    volume: 0.9,
    triggers: {
      needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
      email_queued: { enabled: true, soundId: "quick_chime" },
      fyi_finalized: { enabled: true, soundId: "smooth_modern" },
      weak_security_grace: { enabled: true, soundId: "low_tone" },
      triage_failed: { enabled: false, soundId: "low_tone" },
      event_upcoming: { enabled: true, soundId: "clear_chime" },
      task_completed: { enabled: true, soundId: "smooth_modern" },
    },
  },
  triage_notification_sounds: [
    { id: "smooth_modern", label: "Smooth Modern", path: "/sounds/notifications/smooth-modern.mp3" },
    { id: "clear_chime", label: "Clear chime", path: "/sounds/notifications/clear-chime.mp3" },
    { id: "quick_chime", label: "Quick chime", path: "/sounds/notifications/quick-chime.mp3" },
    { id: "low_tone", label: "Low tone", path: "/sounds/notifications/low-tone.mp3" },
  ],
};

function triageEvent(eventKey = "event-1") {
  return {
    source: "email_triage",
    reason: "email_triage_finalized",
    details: {
      triggerType: "needs_attention_finalized",
      eventKey,
      emailId: "msg-1",
      reason: "email_triage_finalized",
    },
  };
}

function queueEvent(eventKey = "queued-1") {
  return {
    source: "email_triage",
    reason: "email_triage_queued",
    details: {
      triggerType: "email_queued",
      eventKey,
      emailId: "msg-queued",
      reason: "email_triage_queued",
    },
  };
}

function installAudioBoundary({ rejectFirst = false }: { rejectFirst?: boolean } = {}) {
  const paths: string[] = [];
  const instances: Array<{ volume: number }> = [];
  let playCount = 0;
  vi.stubGlobal("Audio", function AudioMock(this: HTMLAudioElement & { path: string }, path: string) {
    this.path = path;
    this.volume = 0;
    paths.push(path);
    instances.push(this);
    this.play = () => {
      playCount += 1;
      return rejectFirst && playCount === 1
        ? Promise.reject(new Error("NotAllowedError"))
        : Promise.resolve();
    };
  });
  return { paths, instances, playCount: () => playCount };
}

describe("useTriageNotificationSounds", () => {
  beforeEach(() => {
    sessionStorage.clear();
    settingsRequestCount = 0;
    vi.stubGlobal("fetch", () => {
      settingsRequestCount += 1;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(settings) } as Response);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("plays configured triage sounds only after audio has been unlocked", async () => {
    const audio = installAudioBoundary();
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleDashboardEvent(triageEvent());
    });
    expect(audio.paths).toEqual([]);

    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    act(() => {
      result.current.handleDashboardEvent(triageEvent("event-2"));
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/clear-chime.mp3");
    });
    expect(audio.playCount()).toBe(1);
    expect(audio.instances[0]?.volume).toBe(0.9);
  });

  it("unlocks audio on the first pointerdown so later events sound without a test play", async () => {
    const audio = installAudioBoundary();
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      document.dispatchEvent(new Event("pointerdown"));
    });
    expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");

    act(() => {
      result.current.handleDashboardEvent(triageEvent());
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/clear-chime.mp3");
    });
  });

  it("unlocks audio on the first keydown as well", async () => {
    installAudioBoundary();
    renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      document.dispatchEvent(new Event("keydown"));
    });

    expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");
  });

  it("dedupes repeated SSE event keys", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleDashboardEvent(triageEvent("event-1"));
      result.current.handleDashboardEvent(triageEvent("event-1"));
    });

    await waitFor(() => {
      expect(audio.paths).toHaveLength(1);
    });
  });

  it("plays configured sounds when mail enters the triage queue", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleDashboardEvent(queueEvent());
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/quick-chime.mp3");
    });
  });

  it("plays the queued sound when a queued snapshot row appears after the initial snapshot", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: {
          queued: [],
        },
      });
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: {
          queued: [{
            account_id: "icloud",
            email_id: "icloud-3232",
          }],
        },
      });
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/quick-chime.mp3");
    });
  });

  it("plays once when the same queued email arrives via SSE and a snapshot diff", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      // Seed the snapshot baseline, then deliver the same email through both
      // publishers: the SSE event and a later snapshot diff.
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: { queued: [] },
      });
      result.current.handleDashboardEvent(queueEvent("email_triage:icloud:icloud-3232:email_triage_queued"));
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: {
          queued: [{
            account_id: "icloud",
            email_id: "icloud-3232",
          }],
        },
      });
    });

    await waitFor(() => {
      expect(audio.paths).toHaveLength(1);
    });
  });

  it("retries an event whose playback failed when a later snapshot re-offers it", async () => {
    // First play() rejects (autoplay block); subsequent plays succeed.
    const audio = installAudioBoundary({ rejectFirst: true });
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    const queuedSnapshot = {
      snapshot: { id: "active" },
      lanes: {
        queued: [{
          account_id: "icloud",
          email_id: "icloud-3232",
        }],
      },
    };
    act(() => {
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: { queued: [] },
      });
      result.current.handleActiveSnapshot(queuedSnapshot);
    });
    await waitFor(() => expect(audio.playCount()).toBe(1));
    // Let the rejection propagate so the gate releases the burned key.
    await act(async () => {});

    act(() => {
      result.current.handleActiveSnapshot(queuedSnapshot);
    });

    await waitFor(() => {
      expect(audio.playCount()).toBe(2);
    }, { timeout: 3000 });
  });

  it("coalesces a burst of new queued snapshot rows into one sound", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: { queued: [] },
      });
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: {
          queued: [
            { account_id: "icloud", email_id: "icloud-1" },
            { account_id: "icloud", email_id: "icloud-2" },
            { account_id: "icloud", email_id: "icloud-3" },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(audio.paths).toHaveLength(1);
    });
  });

  it("does not play queued sounds for rows already present on initial snapshot load", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleActiveSnapshot({
        snapshot: { id: "active" },
        lanes: {
          queued: [{
            account_id: "icloud",
            email_id: "icloud-3232",
          }],
        },
      });
    });

    expect(audio.paths).toEqual([]);
  });

  it("attempts task completion sounds from the completion gesture before the session is unlocked", async () => {
    const audio = installAudioBoundary();
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleTaskCompleted("todo-1");
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/smooth-modern.mp3");
      expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");
    });
  });

  it("plays repeated task completion actions for the same task id", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleTaskCompleted("todo-1");
      result.current.handleTaskCompleted("todo-1");
    });

    await waitFor(() => {
      expect(audio.paths).toEqual([
        "/sounds/notifications/smooth-modern.mp3",
        "/sounds/notifications/smooth-modern.mp3",
      ]);
    });
  });

  it("plays configured sounds for upcoming calendar events and task completion actions", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleCalendarSnapshot({
        lastFetched: "2026-05-06T17:00:00.000Z",
        liveCalendar: [{
          id: "event-1",
          title: "Class",
          startMs: Date.now() + 10 * 60 * 1000,
        }],
      });
      result.current.handleTaskCompleted("todo-1");
    });

    await waitFor(() => {
      expect(audio.paths).toEqual(expect.arrayContaining([
        "/sounds/notifications/clear-chime.mp3",
        "/sounds/notifications/smooth-modern.mp3",
      ]));
    });
  });

  it("schedules the upcoming calendar sound when an event enters the 15-minute window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T17:00:00.000Z"));
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});

    act(() => {
      result.current.handleCalendarSnapshot({
        lastFetched: "2026-05-06T17:00:00.000Z",
        liveCalendar: [{
          id: "event-1",
          title: "Class",
          startMs: Date.now() + 16 * 60 * 1000,
        }],
      });
    });

    expect(audio.paths).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    expect(audio.paths).toContain("/sounds/notifications/clear-chime.mp3");
  });
});
