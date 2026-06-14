/* global process */
import { describe, it, expect, vi, afterEach } from "vitest";
import { daysUntil } from "./bill-utils";
import { dayBucket } from "./shell-helpers";

// The dashboard's canonical day boundary is America/Los_Angeles, not the host's
// local zone. The first suite (P2) forces a non-Pacific host (process.env.TZ=UTC)
// so the machine-local path visibly diverges from the Pacific-anchored one; the
// second suite (P3) asserts daysUntil agrees with dayBucket across the boundary.
// Both exercise the same resolved daysUntil (shared todayPacific/toPacificDate).
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

// daysUntil must compute the day offset against the *Pacific* date boundary, so its
// urgency pills agree with dayBucket / DeadlinesRail (which are hardcoded to Pacific)
// even near the date boundary and on machines whose local timezone is not Pacific.
describe("daysUntil (Pacific date boundary)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a missing date", () => {
    expect(daysUntil()).toBeNull();
    expect(daysUntil("")).toBeNull();
  });

  it("counts 'today' as 0 when UTC has already rolled to the next day but Pacific has not", () => {
    // 2026-06-14T05:00:00Z == 2026-06-13 22:00 PDT. UTC date is the 14th, Pacific is still the 13th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T05:00:00.000Z"));

    expect(daysUntil("2026-06-13")).toBe(0); // today in Pacific
    expect(daysUntil("2026-06-14")).toBe(1); // tomorrow in Pacific
    expect(daysUntil("2026-06-12")).toBe(-1); // yesterday in Pacific
  });

  it("counts 'today' as 0 when UTC is still on the previous day but Pacific has rolled over", () => {
    // Pacific never leads UTC, so this just confirms a mid-Pacific-day instant is stable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T19:00:00.000Z")); // 2026-06-13 12:00 PDT

    expect(daysUntil("2026-06-13")).toBe(0);
    expect(daysUntil("2026-06-20")).toBe(7);
  });

  it("agrees with dayBucket for the same instant across the boundary", () => {
    // Anchor each target date at Pacific noon so dayBucket and daysUntil are comparing the
    // same calendar day; they must produce identical offsets for every target.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T05:00:00.000Z")); // 2026-06-13 22:00 PDT
    const now = Date.now();

    for (const dateStr of ["2026-06-12", "2026-06-13", "2026-06-14", "2026-06-21"]) {
      const noonPacificMs = new Date(`${dateStr}T19:00:00.000Z`).getTime(); // ~12:00 PDT
      expect(daysUntil(dateStr)).toBe(dayBucket(noonPacificMs, now));
    }
  });
});
