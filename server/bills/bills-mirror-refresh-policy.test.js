import { describe, expect, it } from "vitest";
import { shouldScheduleImmediateBillsRefresh } from "./bills-mirror-refresh-policy.js";

// Guards P1-5: a reader (the ~2s dashboard poll, calendar bill reads) must not
// pull a future settle window forward to "now". A write arms a ~60s pending
// refresh so the Actual server can propagate before the local mirror re-syncs;
// rescheduling with delayMs:0 collapses that settle.
const NOW = new Date("2026-05-06T12:00:10.000Z");

describe("shouldScheduleImmediateBillsRefresh", () => {
  it("schedules when needs_sync with no pending refresh", () => {
    expect(
      shouldScheduleImmediateBillsRefresh({ state: "needs_sync", pendingRefreshAt: null }, NOW),
    ).toBe(true);
  });

  it("schedules when the pending refresh is already in the past", () => {
    expect(
      shouldScheduleImmediateBillsRefresh(
        { state: "needs_sync", pendingRefreshAt: "2026-05-06T12:00:00.000Z" },
        NOW,
      ),
    ).toBe(true);
  });

  it("does NOT schedule when a future settle window is still pending", () => {
    expect(
      shouldScheduleImmediateBillsRefresh(
        { state: "needs_sync", pendingRefreshAt: "2026-05-06T12:01:00.000Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT schedule when state is not needs_sync", () => {
    expect(
      shouldScheduleImmediateBillsRefresh({ state: "current", pendingRefreshAt: null }, NOW),
    ).toBe(false);
  });
});
