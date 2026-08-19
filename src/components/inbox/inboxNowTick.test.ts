import { describe, expect, it } from "vitest";
import { computeNextTickDelay, NOW_TICK_MAX_DELAY_MS } from "./inboxNowTick";

const now = 1_000_000;

describe("computeNextTickDelay", () => {
  it("returns null when nothing is pending (idle inbox)", () => {
    expect(computeNextTickDelay(new Map(), [], now)).toBeNull();
    expect(computeNextTickDelay(null, null, now)).toBeNull();
  });

  it("schedules to the soonest still-future snooze boundary", () => {
    const snoozed = new Map([
      ["a", now + 5_000],
      ["b", now + 20_000],
      ["c", now - 1_000], // already expired, ignored
    ]);
    expect(computeNextTickDelay(snoozed, [], now)).toBe(5_000);
  });

  it("caps the delay at the max so a long-future snooze still refreshes", () => {
    const snoozed = new Map([["a", now + 10 * 60_000]]);
    expect(computeNextTickDelay(snoozed, [], now)).toBe(NOW_TICK_MAX_DELAY_MS);
  });

});
