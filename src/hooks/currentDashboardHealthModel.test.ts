import { describe, expect, it } from "vitest";
import type { CurrentDashboardSystemStatus } from "../../shared/types/dashboard";
import { projectDashboardHealth } from "./currentDashboardHealthModel";

describe("calendar client health", () => {
  const status = (state: "current" | "refreshing" = "current"): CurrentDashboardSystemStatus => ({
    state: state === "refreshing" ? "syncing" : "current",
    generatedAt: "2026-09-06T12:06:00.000Z",
    sources: [{
      key: "calendar", label: "Calendar", state, severity: state === "current" ? "none" : "info",
      lastSuccessAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:20:00.000Z",
      message: "Calendar is up to date.", impact: "New or changed events may be missing.",
    }],
  });
  const observation = (now: string) => ({
    readFailed: false, offline: false, liveUpdatesDisconnected: false,
    lastCheckedAt: "2026-09-06T12:06:00.000Z", now: Date.parse(now),
  });

  it("keeps the server's successful-check grace and expires it at twenty minutes", () => {
    expect(projectDashboardHealth(status(), observation("2026-09-06T12:19:59.999Z")).state).toBe("current");
    const expired = projectDashboardHealth(status(), observation("2026-09-06T12:20:00.000Z"));
    expect(expired.state).toBe("needs_sync");
    expect(expired.sources[0]).toMatchObject({
      state: "needs_sync", lastSuccessAt: "2026-09-06T12:00:00.000Z", message: "New or changed events may be missing.",
    });
  });

  it("does not hide an overdue calendar check behind an active refresh", () => {
    const expired = projectDashboardHealth(status("refreshing"), observation("2026-09-06T12:20:00.000Z"));
    expect(expired.state).toBe("needs_sync");
    expect(expired.sources[0]?.state).toBe("needs_sync");
  });

  it.each(["readFailed", "offline", "liveUpdatesDisconnected"] as const)("keeps %s evidence visible during Calendar's grace period", (failure) => {
    const unhealthy = projectDashboardHealth(status(), { ...observation("2026-09-06T12:06:00.000Z"), [failure]: true });
    expect(unhealthy.state).toBe("degraded");
    expect(unhealthy.sources[0]).toMatchObject({ key: "dashboard_connection", severity: "warning" });
    expect(unhealthy.sources[1]?.lastSuccessAt).toBe("2026-09-06T12:00:00.000Z");
  });
});
