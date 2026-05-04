import { describe, expect, it } from "vitest";
import { buildStartupWorkerDelays, calculateStartupDelayMs } from "./startup-delays.js";

describe("startup worker delays", () => {
  it("keeps development and test startup fast by default", () => {
    expect(buildStartupWorkerDelays({ NODE_ENV: "development" }, () => 0.9)).toMatchObject({
      scheduler: 0,
      indexer: 0,
      backfill: 0,
      snooze: 0,
    });
    expect(buildStartupWorkerDelays({ NODE_ENV: "test" }, () => 0.9).indexer).toBe(0);
  });

  it("reserves the first production minute plus bounded jitter", () => {
    expect(calculateStartupDelayMs({ baseMs: 60_000, jitterMs: 60_000, random: () => 0 })).toBe(60_000);
    expect(calculateStartupDelayMs({ baseMs: 60_000, jitterMs: 60_000, random: () => 0.5 })).toBe(90_000);
    expect(calculateStartupDelayMs({ baseMs: 60_000, jitterMs: 60_000, random: () => 0.999 })).toBe(119_940);
  });

  it("allows explicit env overrides for production delay and jitter", () => {
    const delays = buildStartupWorkerDelays({
      NODE_ENV: "production",
      EA_STARTUP_WORKER_DELAY_MS: "120000",
      EA_STARTUP_WORKER_JITTER_MS: "10000",
    }, () => 0.25);

    expect(delays).toMatchObject({
      scheduler: 122_500,
      indexer: 122_500,
      backfill: 122_500,
      snooze: 122_500,
    });
  });
});
