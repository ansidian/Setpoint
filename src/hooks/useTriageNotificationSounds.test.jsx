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

describe("useTriageNotificationSounds", () => {
  beforeEach(() => {
    sessionStorage.clear();
    getSettings.mockReset().mockResolvedValue(settings);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
});
