import { describe, expect, it } from "vitest";

import {
  mergeRefreshScopes,
  refreshScopeForDashboardEvent,
} from "./dashboardEventRefreshModel";

describe("dashboard event refresh model", () => {
  it("uses the active snapshot only for email triage events", () => {
    expect(refreshScopeForDashboardEvent({ source: "email_triage" })).toBe("active_snapshot");
    for (const source of ["todoist", "deadlines", "bills", "reminders", "calendar", "unknown", undefined]) {
      expect(refreshScopeForDashboardEvent({ source })).toBe("current");
    }
    expect(refreshScopeForDashboardEvent(null)).toBe("current");
  });

  it("keeps the strongest pending scope so current can never be downgraded", () => {
    expect(mergeRefreshScopes(null, "active_snapshot")).toBe("active_snapshot");
    expect(mergeRefreshScopes("active_snapshot", "active_snapshot")).toBe("active_snapshot");
    expect(mergeRefreshScopes("active_snapshot", "current")).toBe("current");
    expect(mergeRefreshScopes("current", "active_snapshot")).toBe("current");
    expect(mergeRefreshScopes("current", null)).toBe("current");
  });
});
