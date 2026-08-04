import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playTriageNotificationSound,
  TRIAGE_SOUND_GAIN_MULTIPLIER,
} from "./triageSoundPlayback";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("triage sound playback", () => {
  it("uses a gain stage so 100 percent is louder than native audio volume", async () => {
    let playCount = 0;
    const play = () => { playCount += 1; return Promise.resolve(); };
    const addEventListener = vi.fn();
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
      this.path = path;
      this.volume = 0;
      this.play = play;
      this.addEventListener = addEventListener;
    }));
    let gainDestination: unknown;
    const gain = {
      gain: { value: 0 },
      connect: (destination: unknown) => { gainDestination = destination; },
    };
    let sourceDestination: unknown;
    const source = { connect: (destination: unknown) => { sourceDestination = destination; } };
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
    expect(vi.mocked(globalThis.Audio).mock.instances[0]!.volume).toBe(1);
    expect(gain.gain.value).toBe(TRIAGE_SOUND_GAIN_MULTIPLIER);
    expect(sourceDestination).toBe(gain);
    expect(gainDestination).toBe(context.destination);
    expect(playCount).toBe(1);
  });

  it("scales the gain from the configured slider value", async () => {
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
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

    expect(vi.mocked(globalThis.Audio).mock.instances[0]!.volume).toBe(0.4);
    expect(gain.gain.value).toBeCloseTo(1.2);
  });

  it("ramps down the gain before closing the audio context", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    const listeners: Partial<Record<"loadedmetadata" | "ended", () => void>> = {};
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
      this.path = path;
      this.volume = 0;
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn((eventName: "loadedmetadata" | "ended", handler: () => void) => {
        listeners[eventName] = handler;
      });
    }));
    const gainEvents: Array<[string, ...number[]]> = [];
    const gain = {
      gain: {
        value: 0,
        cancelScheduledValues: (time: number) => { gainEvents.push(["cancel", time]); },
        setValueAtTime: (value: number, time: number) => { gainEvents.push(["set", value, time]); },
        linearRampToValueAtTime: (value: number, time: number) => { gainEvents.push(["ramp", value, time]); },
      },
      connect: vi.fn(),
    };
    let closeCount = 0;
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: () => { closeCount += 1; return Promise.resolve(); },
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );
    listeners.loadedmetadata!();

    await vi.advanceTimersByTimeAsync(455);

    expect(gainEvents).toEqual([
      ["cancel", 10],
      ["set", TRIAGE_SOUND_GAIN_MULTIPLIER, 10],
      ["ramp", 0, 10.04],
    ]);
    expect(closeCount).toBe(0);

    listeners.ended!();
    await vi.advanceTimersByTimeAsync(60);

    expect(closeCount).toBe(1);
  });

  it("closes the audio context on a terminal event other than ended (pause)", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    const listeners: Partial<Record<"pause", () => void>> = {};
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
      this.path = path;
      this.volume = 0;
      this.duration = 0.5;
      this.currentTime = 0;
      this.play = play;
      this.addEventListener = vi.fn((eventName: "pause", handler: () => void) => {
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
    let closeCount = 0;
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: () => { closeCount += 1; return Promise.resolve(); },
    };
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
      return context;
    }));

    await playTriageNotificationSound(
      { path: "/sounds/notifications/clear-chime.mp3" },
      { volume: 1 },
    );

    expect(closeCount).toBe(0);

    listeners.pause!();
    await vi.advanceTimersByTimeAsync(60);

    expect(closeCount).toBe(1);
  });

  it("force-closes the audio context via the safety timeout when no terminal event fires", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
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
    let closeCount = 0;
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: () => { closeCount += 1; return Promise.resolve(); },
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
    expect(closeCount).toBe(0);

    // After the ceiling plus the close delay it is force-closed.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(closeCount).toBe(1);
  });

  it("closes a created audio context when play() rejects", async () => {
    vi.useFakeTimers();
    const play = vi.fn(() => Promise.reject(new Error("blocked")));
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
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
    let closeCount = 0;
    const context = {
      currentTime: 10,
      state: "running",
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => gain),
      close: () => { closeCount += 1; return Promise.resolve(); },
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
    expect(closeCount).toBe(1);
  });

  it("falls back to native playback if Web Audio setup fails", async () => {
    let playCount = 0;
    const play = () => { playCount += 1; return Promise.resolve(); };
    vi.stubGlobal("Audio", vi.fn(function AudioMock(this: Record<string, unknown>, path: string) {
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
    expect(vi.mocked(globalThis.Audio).mock.instances[0]!.volume).toBe(1);
    expect(playCount).toBe(1);
  });
});
