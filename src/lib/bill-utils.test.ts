/* global process */
import { describe, it, expect, vi, afterEach } from "vitest";
import { daysUntil } from "./bill-utils";
import { dayBucket } from "./shell-helpers";

// The dashboard's canonical day boundary is America/Los_Angeles, not the host's
// local zone. These cases own the shared date-offset contract used by bill pills
// and cross-check it against the dashboard's day bucketing at the same instant.
describe("daysUntil (Pacific date boundary)", () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
    vi.useRealTimers();
  });

  it("returns null for a missing date", () => {
    expect(daysUntil()).toBeNull();
    expect(daysUntil("")).toBeNull();
  });

  it("counts 'today' as 0 when UTC has already rolled to the next day but Pacific has not", () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T05:00:00.000Z"));

    expect(daysUntil("2026-06-12")).toBe(-1);
    expect(daysUntil("2026-06-13")).toBe(0);
    expect(daysUntil("2026-06-14")).toBe(1);
  });

  it("agrees with dayBucket for the same instant across the boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T05:00:00.000Z"));
    const now = Date.now();

    for (const dateStr of ["2026-06-12", "2026-06-13", "2026-06-14", "2026-06-21"]) {
      const noonPacificMs = new Date(`${dateStr}T19:00:00.000Z`).getTime();
      expect(daysUntil(dateStr)).toBe(dayBucket(noonPacificMs, now));
    }
  });
});
