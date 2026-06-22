import { describe, it, expect } from "vitest";
import { computeCalendarSearchMirrorHealth } from "./calendarSearchMirrorHealthModel.js";

const now = new Date("2026-05-12T19:00:00.000Z");
const row = (over) => ({ account_id: "a1", calendar_id: "c1", status: "idle", ...over });

describe("computeCalendarSearchMirrorHealth", () => {
  it("is initializing with no sources", () => {
    expect(computeCalendarSearchMirrorHealth([], { now })).toEqual({
      state: "initializing",
      configured: true,
      severity: "info",
      sources: [],
    });
  });

  it("is current with computed ageMs when fresh and clean", () => {
    const health = computeCalendarSearchMirrorHealth([row({ last_success_at: "2026-05-12T18:59:30.000Z" })], { now });
    expect(health).toMatchObject({ state: "current", severity: "none" });
    expect(health.sources[0]).toMatchObject({ state: "current", ageMs: 30_000 });
  });

  it("is syncing while the row is mid-sync", () => {
    expect(computeCalendarSearchMirrorHealth([row({ status: "syncing", last_success_at: "2026-05-12T18:00:00.000Z" })], { now }))
      .toMatchObject({ state: "syncing", severity: "info" });
  });

  it("is initializing when a source has never succeeded", () => {
    expect(computeCalendarSearchMirrorHealth([row({ last_success_at: null })], { now }))
      .toMatchObject({ state: "initializing", severity: "info" });
  });

  it("is dirty when dirty_since postdates the last success", () => {
    expect(computeCalendarSearchMirrorHealth([row({
      last_success_at: "2026-05-12T18:59:00.000Z",
      dirty_since: "2026-05-12T18:59:30.000Z",
      dirty_reason: "calendar-write",
    })], { now })).toMatchObject({
      state: "dirty",
      severity: "warning",
      sources: [expect.objectContaining({ dirtyReason: "calendar-write" })],
    });
  });

  it("is stale once the last success is older than the stale threshold", () => {
    expect(computeCalendarSearchMirrorHealth([row({ last_success_at: "2026-05-12T10:00:00.000Z" })], { now }))
      .toMatchObject({ state: "stale", severity: "warning" });
  });

  it("is degraded after repeated failures older than the degraded threshold", () => {
    expect(computeCalendarSearchMirrorHealth([row({
      last_success_at: "2026-05-10T10:00:00.000Z",
      last_check_failed_at: "2026-05-11T10:00:00.000Z",
      failed_check_count: 3,
      last_error: "Google temporarily unavailable",
    })], { now })).toMatchObject({
      state: "degraded",
      severity: "warning",
      sources: [expect.objectContaining({ failedCheckCount: 3 })],
    });
  });

  it("aggregates to the most severe source state (degraded wins over dirty/current)", () => {
    const health = computeCalendarSearchMirrorHealth([
      row({ account_id: "a1", calendar_id: "current", last_success_at: "2026-05-12T18:59:30.000Z" }),
      row({ account_id: "a1", calendar_id: "dirty", last_success_at: "2026-05-12T18:59:00.000Z", dirty_since: "2026-05-12T18:59:30.000Z" }),
      row({ account_id: "a1", calendar_id: "degraded", last_success_at: "2026-05-10T10:00:00.000Z", last_check_failed_at: "2026-05-11T10:00:00.000Z", failed_check_count: 2 }),
    ], { now });
    expect(health).toMatchObject({ state: "degraded", severity: "warning" });
    expect(health.sources).toHaveLength(3);
  });
});
