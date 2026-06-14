import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playTriageNotificationSound,
  TRIAGE_SOUND_GAIN_MULTIPLIER,
} from "./triageSoundPlayback.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("triage sound playback", () => {
  it("uses a gain stage so 100 percent is louder than native audio volume", async () => {
    const play = vi.fn(() => Promise.resolve());
    const addEventListener = vi.fn();
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.play = play;
      this.addEventListener = addEventListener;
    }));
    const gain = {
      gain: { value: 0 },
      connect: vi.fn(),
    };
    const source = { connect: vi.fn() };
    const context = {
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => source),
      createGain: vi.fn(() => gain),
      close: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    const result = await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    expect(result).toBe(true);
    expect(globalThis.Audio.mock.instances[0].volume).toBe(1);
    expect(gain.gain.value).toBe(TRIAGE_SOUND_GAIN_MULTIPLIER);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(play).toHaveBeenCalled();
  });

  it("scales the gain from the configured slider value", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.play = play;
    }));
    const gain = {
      gain: { value: 0 },
      connect: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return {
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      };
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 0.4 },
    );

    expect(globalThis.Audio.mock.instances[0].volume).toBe(0.4);
    expect(gain.gain.value).toBeCloseTo(1.2);
  });

  it("ramps down the gain before closing the audio context", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    const listeners = {};
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn((eventName, handler) => {
        listeners[eventName] = handler;
      });
    }));
    const gain = {
      gain: {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );
    listeners.loadedmetadata();

    await vi.advanceTimersByTimeAsync(455);

    expect(gain.gain.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(TRIAGE_SOUND_GAIN_MULTIPLIER, 10);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.04);
    expect(context.close).not.toHaveBeenCalled();

    listeners.ended();
    await vi.advanceTimersByTimeAsync(60);

    expect(context.close).toHaveBeenCalled();
  });

  it("closes the audio context on a terminal event other than ended (pause)", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    const listeners = {};
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn((eventName, handler) => {
        listeners[eventName] = handler;
      });
    }));
    const gain = {
      gain: {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    expect(context.close).not.toHaveBeenCalled();

    listeners.pause();
    await vi.advanceTimersByTimeAsync(60);

    expect(context.close).toHaveBeenCalled();
  });

  it("force-closes the audio context via the safety timeout when no terminal event fires", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      // Unknown duration: forces the conservative fallback ceiling.
      this.duration = NaN;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn();
    }));
    const gain = {
      gain: {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    // Before the fallback ceiling (30s) the context is still open.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(context.close).not.toHaveBeenCalled();

    // After the ceiling plus the close delay it is force-closed.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(context.close).toHaveBeenCalled();
  });

  it("closes a created audio context when play() rejects", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.reject(new Error("blocked")));
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn();
    }));
    const gain = {
      gain: {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: vi.fn(),
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    const result = await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    expect(result).toBe(false);

    await vi.advanceTimersByTimeAsync(60);
    expect(context.close).toHaveBeenCalled();
  });

  it("falls back to native playback if Web Audio setup fails", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(path) {
      this.path = path;
      this.volume = 0;
      this.play = play;
    }));
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return {
        createMediaElementSource: vi.fn(() => {
          throw new Error("blocked");
        }),
      };
    }));

    const result = await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    expect(result).toBe(true);
    expect(globalThis.Audio.mock.instances[0].volume).toBe(1);
    expect(play).toHaveBeenCalled();
  });
});
