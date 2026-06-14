/* global process */
import { describe, it, expect, vi, afterEach } from "vitest";
import { daysUntil } from "./bill-utils";

// The dashboard's canonical day boundary is America/Los_Angeles, not the host's
// local zone. These tests force a non-Pacific host (process.env.TZ=UTC) so the
// machine-local path visibly diverges from the Pacific-anchored one — without
// that, the bug is invisible on a Pacific dev box.
describe("daysUntil (Pacific-anchored)", () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
    vi.useRealTimers();
  });

  it("counts days from the Pacific 'today', not the host-local day", () => {
    process.env.TZ = "UTC";
    // 2026-01-16T03:00Z is still 2026-01-15 19:00 in Pacific (PST) → Pacific today = Jan 15.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-16T03:00:00Z"));
    expect(daysUntil("2026-01-16")).toBe(1); // tomorrow in Pacific (host-local would say 0)
  });

  it("returns 0 for the Pacific today even on a UTC host", () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-16T03:00:00Z")); // Pacific date = Jan 15
    expect(daysUntil("2026-01-15")).toBe(0);
  });

  it("returns null for an empty date", () => {
    expect(daysUntil("")).toBeNull();
  });
});
