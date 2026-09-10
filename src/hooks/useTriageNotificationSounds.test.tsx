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
      needs_attention_finalized: { enabled: true, soundId: "signal" },
      email_queued: { enabled: true, soundId: "arrival" },
      fyi_finalized: { enabled: true, soundId: "aside" },
      triage_failed: { enabled: false, soundId: "check" },
      event_upcoming: { enabled: true, soundId: "signal" },
      task_completed: { enabled: true, soundId: "aside" },
    },
  },
  triage_notification_sounds: [
    { id: "aside", label: "Aside", path: "/sounds/notifications/aside.mp3" },
    { id: "signal", label: "Signal", path: "/sounds/notifications/signal.mp3" },
    { id: "arrival", label: "Arrival", path: "/sounds/notifications/arrival.mp3" },
    { id: "check", label: "Check", path: "/sounds/notifications/check.mp3" },
  ],
};

function triageEvent(eventKey = "event-1", emailReceivedAt = new Date().toISOString()) {
  return {
    source: "email_triage",
    reason: "email_triage_finalized",
    occurredAt: new Date().toISOString(),
    details: {
      triggerType: "needs_attention_finalized",
      eventKey,
      emailId: "msg-1",
      reason: "email_triage_finalized",
      emailReceivedAt,
    },
  };
}

function queueEvent(eventKey = "queued-1") {
  return {
    source: "email_triage",
    reason: "email_triage_queued",
    occurredAt: new Date().toISOString(),
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
    vi.restoreAllMocks();
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
      expect(audio.paths).toContain("/sounds/notifications/signal.mp3");
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
      expect(audio.paths).toContain("/sounds/notifications/signal.mp3");
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

  it("does not play finalized-email sounds after the five-minute arrival window", async () => {
    const audio = installAudioBoundary();
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const { result } = renderHook(() => useTriageNotificationSounds());
    await waitFor(() => expect(settingsRequestCount).toBe(1));

    act(() => {
      result.current.handleDashboardEvent(triageEvent(
        "stale-event",
        new Date(Date.now() - 5 * 60 * 1000 - 1).toISOString(),
      ));
    });

    await act(async () => {});
    expect(audio.paths).toEqual([]);
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
      expect(audio.paths).toContain("/sounds/notifications/arrival.mp3");
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
            account_id: "icloud", date: new Date().toISOString(),
            email_id: "icloud-3232",
          }],
        },
      });
    });

    await waitFor(() => {
      expect(audio.paths).toContain("/sounds/notifications/arrival.mp3");
    });
  });

  it("does not play the queued sound when a newly queued snapshot row is already read", async () => {
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
          queued: [{
            account_id: "icloud", date: new Date().toISOString(),
            email_id: "icloud-read",
            read: true,
          }],
        },
      });
    });

    await act(async () => {});
    expect(audio.paths).toEqual([]);
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
            account_id: "icloud", date: new Date().toISOString(),
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
          account_id: "icloud", date: new Date().toISOString(),
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
            { account_id: "icloud", date: new Date().toISOString(), email_id: "icloud-1" },
            { account_id: "icloud", date: new Date().toISOString(), email_id: "icloud-2" },
            { account_id: "icloud", date: new Date().toISOString(), email_id: "icloud-3" },
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
            account_id: "icloud", date: new Date().toISOString(),
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
      expect(audio.paths).toContain("/sounds/notifications/aside.mp3");
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
        "/sounds/notifications/aside.mp3",
        "/sounds/notifications/aside.mp3",
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
        "/sounds/notifications/signal.mp3",
        "/sounds/notifications/aside.mp3",
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

    expect(audio.paths).toContain("/sounds/notifications/signal.mp3");
  });

  it('does not release queued overnight email sounds when suspended audio resumes on return', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T06:00:00Z"));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    let resumeAudio: () => void = () => {};
    const suspendedUntilReturn = new Promise<void>((resolve) => { resumeAudio = resolve; });
    let returned = false;
    const played: string[] = [];
    vi.stubGlobal('Audio', function AudioMock(this: Record<string, unknown>, path: string) {
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = () => { played.push(path); return Promise.resolve(); };
      this.addEventListener = () => {};
    });
    vi.stubGlobal('AudioContext', function ContextMock() {
      return {
        state: returned ? 'running' : 'suspended',
        currentTime: 0,
        destination: {},
        createMediaElementSource: () => ({ connect: () => {} }),
        createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
        resume: () => suspendedUntilReturn,
        close: () => Promise.resolve(),
      };
    });
    const { result } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});
    for (let i = 0; i < 3; i += 1) {
      act(() => result.current.handleDashboardEvent({
        source: 'email_triage',
        occurredAt: new Date().toISOString(),
        details: {
          triggerType: 'needs_attention_finalized',
          eventKey: `overnight-${i}`,
          emailReceivedAt: new Date().toISOString(),
          read: false,
        },
      }));
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    }
    expect(played).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000); });
    returned = true;
    await act(async () => { resumeAudio(); await vi.advanceTimersByTimeAsync(2000); });
    expect(played).toEqual([]);
  });

  it('does not sound old unread rows discovered after the first snapshot during visiting sync', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T06:00:00Z"));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const played: string[] = [];
    vi.stubGlobal('Audio', function AudioMock(this: Record<string, unknown>, path: string) {
      this.play = () => { played.push(path); return Promise.resolve(); };
    });
    const { result } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});
    act(() => result.current.handleActiveSnapshot({ snapshot: { id: 'active' }, lanes: { queued: [] } }));
    const oldRows = [1, 2, 3].map((i) => ({ account_id: 'gmail', email_id: `old-${i}`, read: false, date: '2026-09-08T22:00:00Z', email_date: '2026-09-08T22:00:00Z' }));
    for (let count = 1; count <= oldRows.length; count += 1) {
      act(() => result.current.handleActiveSnapshot({ snapshot: { id: 'active' }, lanes: { queued: oldRows.slice(0, count) } }));
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    }
    expect(played).toEqual([]);
  });

  it("keeps playable background arrivals audible but suppresses pre-return mail still inside five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T06:00:00Z"));
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const audio = installAudioBoundary();
    const { result } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});
    act(() => {
      result.current.handleActiveSnapshot({ snapshot: { id: "active" }, lanes: { queued: [] } });
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      result.current.handleDashboardEvent(triageEvent("playable-background"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(audio.playCount()).toBe(1);
    const preReturnArrival = new Date().toISOString();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      result.current.handleDashboardEvent(triageEvent("caught-up-sse", preReturnArrival));
      result.current.handleActiveSnapshot({ snapshot: { id: "active" }, lanes: { queued: [{
        account_id: "gmail", email_id: "caught-up-snapshot", date: preReturnArrival,
      }] } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(audio.playCount()).toBe(1);
    act(() => result.current.handleDashboardEvent(triageEvent("post-return")));
    await act(async () => {});
    expect(audio.playCount()).toBe(2);
  });

  it("uses this document's activation instead of a previous document's saved unlock", async () => {
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    const activation = { hasBeenActive: false, isActive: false };
    vi.stubGlobal("navigator", { ...navigator, userActivation: activation });
    const audio = installAudioBoundary();
    const { result } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});
    act(() => result.current.handleDashboardEvent(triageEvent("before-activation")));
    await act(async () => {});
    expect(audio.playCount()).toBe(0);
    activation.hasBeenActive = true;
    act(() => result.current.handleDashboardEvent(triageEvent("after-activation")));
    await act(async () => {});
    expect(audio.playCount()).toBe(1);
  });

  it("cancels a pending browser play when the dashboard unmounts", async () => {
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
    let stopped = false;
    let finishStartup: () => void = () => {};
    let audible = false;
    vi.stubGlobal("Audio", function AudioMock(this: Record<string, unknown>) {
      this.play = () => new Promise<void>((resolve) => {
        finishStartup = () => { audible = !stopped; resolve(); };
      });
      this.pause = () => { stopped = true; };
    });
    const { result, unmount } = renderHook(() => useTriageNotificationSounds());
    await act(async () => {});
    act(() => result.current.handleDashboardEvent(triageEvent("pending-unmount")));
    await act(async () => {});
    unmount();
    await act(async () => { finishStartup(); });
    expect(stopped).toBe(true);
    expect(audible).toBe(false);
  });

});
