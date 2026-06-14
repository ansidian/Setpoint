import { describe, expect, it } from "vitest";
import { mergeFailedPayload } from "./useSettingsPage.js";

// Guards P1-3 half (b) / P2-10: a failed auto-save flush must NOT silently drop
// the user's edits. The merge re-queues the failed fields while letting any
// edits made during the in-flight request win, so nothing is lost or clobbered.
describe("mergeFailedPayload", () => {
  it("re-queues all failed fields when nothing newer is pending", () => {
    expect(
      mergeFailedPayload({}, { triage_mode: "auto", lookback_hours: 6 }),
    ).toEqual({ triage_mode: "auto", lookback_hours: 6 });
  });

  it("lets newer pending edits win over re-queued failed values", () => {
    expect(
      mergeFailedPayload(
        { triage_mode: "paused" },
        { triage_mode: "auto", lookback_hours: 6 },
      ),
    ).toEqual({ triage_mode: "paused", lookback_hours: 6 });
  });
});
