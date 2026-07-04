import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIAGE_SOUND_AUDIO_UNLOCK_KEY } from "@/lib/triageSoundPlayback";

vi.mock("@/api", () => ({
  getSettings: vi.fn(),
}));

const { getSettings } = await import("@/api");
const { default: useTriageNotificationSounds } = await import("./useTriageNotificationSounds.js");

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

describe("useTriageNotificationSounds", () => {
  beforeEach(() => {
    sessionStorage.clear();
    getSettings.mockReset().mockResolvedValue(settings);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("plays configured triage sounds only after audio has been unlocked", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      result.current.handleDashboardEvent(triageEvent());
    });
    expect(globalThis.Audio).not.toHaveBeenCalled();

    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    act(() => {
      result.current.handleDashboardEvent(triageEvent("event-2"));
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/clear-chime.mp3");
    });
    expect(play).toHaveBeenCalled();
    expect(globalThis.Audio.mock.instances[0].volume).toBe(0.9);
  });

  it("unlocks audio on the first pointerdown so later events sound without a test play", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      document.dispatchEvent(new Event("pointerdown"));
    });
    expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");

    act(() => {
      result.current.handleDashboardEvent(triageEvent());
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/clear-chime.mp3");
    });
  });

  it("unlocks audio on the first keydown as well", async () => {
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = vi.fn(() => Promise.resolve());
    }));
    renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      document.dispatchEvent(new Event("keydown"));
    });

    expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");
  });

  it("dedupes repeated SSE event keys", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      result.current.handleDashboardEvent(triageEvent("event-1"));
      result.current.handleDashboardEvent(triageEvent("event-1"));
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledTimes(1);
    });
  });

  it("plays configured sounds when mail enters the triage queue", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      result.current.handleDashboardEvent(queueEvent());
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/quick-chime.mp3");
    });
  });

  it("plays the queued sound when a queued snapshot row appears after the initial snapshot", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/quick-chime.mp3");
    });
  });

  it("plays once when the same queued email arrives via SSE and a snapshot diff", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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
      expect(globalThis.Audio).toHaveBeenCalledTimes(1);
    });
  });

  it("retries an event whose playback failed when a later snapshot re-offers it", async () => {
    // First play() rejects (autoplay block); subsequent plays succeed.
    const play = vi.fn()
      .mockRejectedValueOnce(new Error("NotAllowedError"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    // Let the rejection propagate so the gate releases the burned key.
    await act(async () => {});

    act(() => {
      result.current.handleActiveSnapshot(queuedSnapshot);
    });

    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });
  });

  it("coalesces a burst of new queued snapshot rows into one sound", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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
      expect(globalThis.Audio).toHaveBeenCalledTimes(1);
    });
  });

  it("does not play queued sounds for rows already present on initial snapshot load", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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

    expect(globalThis.Audio).not.toHaveBeenCalled();
  });

  it("attempts task completion sounds from the completion gesture before the session is unlocked", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      result.current.handleTaskCompleted("todo-1");
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/smooth-modern.mp3");
      expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");
    });
  });

  it("plays repeated task completion actions for the same task id", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      result.current.handleTaskCompleted("todo-1");
      result.current.handleTaskCompleted("todo-1");
    });

    await waitFor(() => {
      expect(globalThis.Audio).toHaveBeenCalledTimes(2);
      expect(globalThis.Audio).toHaveBeenNthCalledWith(1, "/sounds/notifications/smooth-modern.mp3");
      expect(globalThis.Audio).toHaveBeenNthCalledWith(2, "/sounds/notifications/smooth-modern.mp3");
    });
  });

  it("plays configured sounds for upcoming calendar events and task completion actions", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

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
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/clear-chime.mp3");
      expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/smooth-modern.mp3");
    });
  });

  it("schedules the upcoming calendar sound when an event enters the 15-minute window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T17:00:00.000Z"));
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    }));
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

    expect(globalThis.Audio).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    expect(globalThis.Audio).toHaveBeenCalledWith("/sounds/notifications/clear-chime.mp3");
  });
});
