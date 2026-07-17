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

  it("schedules to the next grace-label bucket transition (regression: list label must advance)", () => {
    // classifyAt is 5 min out -> next bucket flip is classifyAt-120s = now+180s,
    // but that exceeds the 30s cap, so it ticks within the cap window.
    const classifyAt = now + 5 * 60_000;
    expect(computeNextTickDelay(new Map(), [{ _pendingSecurityGraceAt: classifyAt }], now))
      .toBe(NOW_TICK_MAX_DELAY_MS);
  });

  it("fires exactly at the next grace bucket mark when it is within the cap", () => {
    // 70s remaining: next flip (Classifying soon -> Classifying in <1m) is at
    // classifyAt-60s = now+10s.
    const classifyAt = now + 70_000;
    expect(computeNextTickDelay(new Map(), [{ _pendingSecurityGraceAt: classifyAt }], now))
      .toBe(10_000);
  });

  it("stops scheduling for grace once classifyAt has passed (label stays 'Classifying')", () => {
    const classifyAt = now - 1_000;
    expect(computeNextTickDelay(new Map(), [{ _pendingSecurityGraceAt: classifyAt }], now)).toBeNull();
  });

  it("takes the soonest across both snooze and grace", () => {
    const snoozed = new Map([["a", now + 25_000]]);
    const rows = [{ _pendingSecurityGraceAt: now + 60_000 }]; // grace flip at now (passed) / +60s mark? -60s = now -> nope; next future mark is classifyAt-0=now+60s
    // grace marks for classifyAt=now+60s: now-60s (past), now (==now, not >now), now+60s -> 60s
    // snooze 25s is sooner.
    expect(computeNextTickDelay(snoozed, rows, now)).toBe(25_000);
  });

  it("ignores rows without a finite grace timestamp", () => {
    const rows = [{}, { _pendingSecurityGraceAt: null }, { _pendingSecurityGraceAt: NaN }];
    expect(computeNextTickDelay(new Map(), rows, now)).toBeNull();
  });
});
