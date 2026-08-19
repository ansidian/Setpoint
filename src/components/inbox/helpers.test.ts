import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSnoozePresets,
  defaultSnoozeTs,
} from "./helpers";

// Renders an epoch-ms value as "YYYY-MM-DD HH:mm" wall-clock in a given TZ so
// the snooze assertions read in human terms instead of raw epoch math.
function wallClock(epochMs: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(epochMs)).replace(",", "");
}

describe("inbox helpers", () => {
  it("builds the fixed-duration snooze presets in increasing order", () => {
    expect(buildSnoozePresets(0)).toEqual([
      { key: "1h", label: "1 hour", at: 3_600_000 },
      { key: "6h", label: "6 hours", at: 21_600_000 },
      { key: "24h", label: "24 hours", at: 86_400_000 },
      { key: "3d", label: "3 days", at: 259_200_000 },
      { key: "1w", label: "1 week", at: 604_800_000 },
    ]);
  });

  describe("defaultSnoozeTs", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // PDT instant (summer, UTC-7): 2026-07-15 14:00 Pacific. Next Pacific day is
    // the 16th, so the default snooze must land at 2026-07-16 09:00 Pacific
    // regardless of the host machine's local timezone.
    it("snoozes to 9:00 the next Pacific day during PDT", () => {
      vi.setSystemTime(new Date("2026-07-15T21:00:00.000Z")); // 14:00 PDT

      const ts = defaultSnoozeTs();

      expect(wallClock(ts, "America/Los_Angeles")).toBe("2026-07-16 09:00");
    });

    // PST instant (winter, UTC-8): 2026-01-15 22:00 Pacific. Next Pacific day is
    // the 16th -> 2026-01-16 09:00 Pacific. This instant is already the 16th in
    // UTC, which is exactly the case the old host-local Date.setHours version
    // got wrong on non-Pacific hosts.
    it("snoozes to 9:00 the next Pacific day during PST", () => {
      vi.setSystemTime(new Date("2026-01-16T06:00:00.000Z")); // 22:00 PST on the 15th

      const ts = defaultSnoozeTs();

      expect(wallClock(ts, "America/Los_Angeles")).toBe("2026-01-16 09:00");
    });
  });
});
