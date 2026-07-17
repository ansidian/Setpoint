import { describe, it, expect } from "vitest";
import { computeTodoistMirrorHealth } from "./todoistMirrorHealthModel.ts";

const now = new Date("2026-05-04T15:00:30.000Z");

describe("computeTodoistMirrorHealth", () => {
  it("is unconfigured when there is no token", () => {
    expect(computeTodoistMirrorHealth({ last_success_at: "2026-05-04T15:00:00.000Z" }, { now, configured: false }))
      .toMatchObject({ state: "unconfigured", configured: false, severity: "none", ageMs: null });
  });

  it("is unavailable when configured but no sync-state row exists", () => {
    expect(computeTodoistMirrorHealth(null, { now, configured: true }))
      .toMatchObject({ state: "unavailable", configured: true, severity: "error", ageMs: null });
  });

  it("is unavailable when the row has never had a successful sync", () => {
    expect(computeTodoistMirrorHealth({ status: "idle", last_success_at: null, last_error: "boom" }, { now, configured: true }))
      .toMatchObject({ state: "unavailable", severity: "error", lastError: "boom", ageMs: null });
  });

  it("is current with computed ageMs when fresh and unpending", () => {
    expect(computeTodoistMirrorHealth({ status: "idle", last_success_at: "2026-05-04T15:00:00.000Z" }, { now, configured: true }))
      .toMatchObject({ state: "current", severity: "none", ageMs: 30_000 });
  });

  it("is needs_sync (warning) when a sync request postdates the last success", () => {
    expect(computeTodoistMirrorHealth({
      status: "idle",
      last_success_at: "2026-05-04T14:59:00.000Z",
      sync_requested_at: "2026-05-04T15:00:00.000Z",
      sync_request_reason: "todoist-webhook",
    }, { now, configured: true })).toMatchObject({
      state: "needs_sync",
      severity: "warning",
      syncRequestReason: "todoist-webhook",
    });
  });

  it("is syncing/info while in flight without pending evidence, syncing/warning with it", () => {
    expect(computeTodoistMirrorHealth({ status: "syncing", last_success_at: "2026-05-04T14:59:00.000Z" }, { now, configured: true }))
      .toMatchObject({ state: "syncing", severity: "info" });
    expect(computeTodoistMirrorHealth({
      status: "syncing",
      last_success_at: "2026-05-04T14:59:00.000Z",
      sync_requested_at: "2026-05-04T15:00:00.000Z",
    }, { now, configured: true })).toMatchObject({ state: "syncing", severity: "warning" });
  });

  it("is degraded (warning) after a stale success plus failed checks, with no pending request", () => {
    expect(computeTodoistMirrorHealth({
      status: "idle",
      last_success_at: "2026-05-03T14:00:00.000Z", // >24h before now
      last_check_failed_at: "2026-05-04T14:55:00.000Z",
      failed_check_count: 3,
    }, { now, configured: true })).toMatchObject({
      state: "degraded",
      severity: "warning",
      failedCheckCount: 3,
    });
  });
});
