import { describe, expect, it } from "vitest";
import { resolveDashboardBriefingState } from "./Dashboard.bootState";

describe("Dashboard boot state", () => {
  it("waits for the current envelope when no active snapshot can render", () => {
    expect(resolveDashboardBriefingState({
      loading: true,
      error: null,
      briefing: null,
      activeSnapshot: null,
    })).toEqual({
      view: "loading",
      canRenderActiveSnapshot: false,
      effectiveBriefing: null,
    });
  });

  it("shows the error state when no briefing or active snapshot is available", () => {
    expect(resolveDashboardBriefingState({
      loading: false,
      error: "Current dashboard unavailable",
      briefing: null,
      activeSnapshot: null,
    })).toEqual({
      view: "error",
      canRenderActiveSnapshot: false,
      effectiveBriefing: null,
      error: "Current dashboard unavailable",
    });
  });

  it("shows the empty state when no dashboard data exists", () => {
    expect(resolveDashboardBriefingState({
      loading: false,
      error: null,
      briefing: null,
      activeSnapshot: null,
    })).toEqual({
      view: "empty",
      canRenderActiveSnapshot: false,
      effectiveBriefing: null,
    });
  });

  it("renders the dashboard from an active snapshot without a separate briefing", () => {
    const activeSnapshot = { snapshot: { id: 42 } };

    expect(resolveDashboardBriefingState({
      loading: true,
      error: null,
      briefing: null,
      activeSnapshot,
    })).toEqual({
      view: "dashboard",
      canRenderActiveSnapshot: true,
      effectiveBriefing: null,
    });
  });

  it("prefers the current briefing when both briefing and snapshot data exist", () => {
    const briefing = { calendar: [{ id: "event-1" }] };

    expect(resolveDashboardBriefingState({
      loading: false,
      error: null,
      briefing,
      activeSnapshot: { snapshot: { id: 42 } },
    })).toEqual({
      view: "dashboard",
      canRenderActiveSnapshot: true,
      effectiveBriefing: briefing,
    });
  });
});
