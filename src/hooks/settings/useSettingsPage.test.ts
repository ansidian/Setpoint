import { describe, expect, it } from "vitest";
import { mergeFailedPayload } from "./useSettingsPage";

// Guards P1-3 half (b) / P2-10: a failed auto-save flush must NOT silently drop
// the user's edits. The merge re-queues the failed fields while letting any
// edits made during the in-flight request win, so nothing is lost or clobbered.
describe("mergeFailedPayload", () => {

  it("lets newer pending edits win over re-queued failed values", () => {
    expect(
      mergeFailedPayload(
        { email_triage_mode: "paused" },
        { email_triage_mode: "auto", weather_lat: 40 },
      ),
    ).toEqual({ email_triage_mode: "paused", weather_lat: 40 });
  });
});
