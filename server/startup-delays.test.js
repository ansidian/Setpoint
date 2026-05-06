import { describe, expect, it } from "vitest";
import { buildStartupWorkerDelays, calculateStartupDelayMs } from "./startup-delays.js";

describe("startup worker delays", () => {
  it("keeps development and test startup fast by default", () => {
    expect(buildStartupWorkerDelays({ NODE_ENV: "development" }, () => 0.9)).toMatchObject({
      scheduler: 0,
      indexer: 0,
      backfill: 0,
      snooze: 0,
      billsMirror: 0,
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
      indexer: 242_500,
      backfill: 722_500,
      snooze: 122_500,
      todoistSync: 122_500,
      billsMirror: 152_500,
    });
  });

  it("stagger production startup workers so heavy catch-up work does not contend with first dashboard load", () => {
    const delays = buildStartupWorkerDelays({ NODE_ENV: "production" }, () => 0);

    expect(delays).toMatchObject({
      scheduler: 60_000,
      snooze: 60_000,
      todoistSync: 60_000,
      billsMirror: 90_000,
      indexer: 180_000,
      backfill: 660_000,
    });
  });

  it("allows per-worker startup offset overrides", () => {
    const delays = buildStartupWorkerDelays({
      NODE_ENV: "production",
      EA_STARTUP_WORKER_DELAY_MS: "1000",
      EA_STARTUP_WORKER_JITTER_MS: "0",
      EA_STARTUP_INDEXER_OFFSET_MS: "2000",
      EA_STARTUP_BACKFILL_OFFSET_MS: "3000",
      EA_STARTUP_TODOIST_SYNC_OFFSET_MS: "4000",
      EA_STARTUP_BILLS_MIRROR_OFFSET_MS: "5000",
    }, () => 0);

    expect(delays).toMatchObject({
      scheduler: 1000,
      indexer: 3000,
      backfill: 4000,
      todoistSync: 5000,
      billsMirror: 6000,
    });
  });
});
