import { describe, expect, it } from "vitest";
import {
  buildDashboardEventsData,
  resolveCalendarOpenState,
  resolveDashboardShellHotkey,
} from "./dashboardShellModel.js";

describe("dashboard shell model", () => {
  it("normalizes calendar open requests without rendering RedesignShell", () => {
    expect(resolveCalendarOpenState({
      isMobile: true,
      viewKey: "events",
    })).toBeNull();

    expect(resolveCalendarOpenState({
      isMobile: false,
      viewKey: "deadlines",
      currentView: "bills",
      showBills: true,
      focusDate: "2026-05-07",
      focusItemId: 42,
      options: { openDetail: true, forceDeadlineOverlay: true },
    })).toEqual({
      view: "events",
      focusDate: "2026-05-07",
      focusItemId: "42",
      focusOpenDetail: true,
      forceDeadlineOverlay: true,
      shouldLoadDeadlines: true,
      shouldLoadBills: false,
    });

    expect(resolveCalendarOpenState({
      isMobile: false,
      viewKey: "bills",
      currentView: "events",
      showBills: false,
    })).toMatchObject({
      view: "events",
      shouldLoadBills: false,
    });
  });

  it("resolves shell hotkeys and g-chords as commands", () => {
    expect(resolveDashboardShellHotkey({ key: "k", metaKey: true })).toEqual({ action: "open-palette" });
    expect(resolveDashboardShellHotkey({ key: "g" })).toEqual({ action: "start-g-chord" });
    expect(resolveDashboardShellHotkey({ key: "t", actionChord: "g" })).toEqual({
      action: "open-todoist-create",
      clearChord: true,
    });
    expect(resolveDashboardShellHotkey({ key: "c", actionChord: "g" })).toEqual({
      action: "open-event-create",
      clearChord: true,
    });
    expect(resolveDashboardShellHotkey({ key: "c", calendarOpen: false })).toEqual({ action: "open-calendar" });
    expect(resolveDashboardShellHotkey({ key: "c", calendarOpen: true })).toEqual({ action: "ignore" });
    expect(resolveDashboardShellHotkey({ key: "a" })).toEqual({ action: "toggle-analytics" });
    expect(resolveDashboardShellHotkey({ key: "y" })).toEqual({ action: "toggle-history" });
  });

  it("clears action chords from editable targets instead of dispatching commands", () => {
    expect(resolveDashboardShellHotkey({
      key: "t",
      actionChord: "g",
      editableTarget: true,
    })).toEqual({ action: "clear-chord" });
  });

  it("projects calendar range props into the modal events contract", () => {
    const ensureRange = () => {};
    const getEvents = () => [];
    expect(buildDashboardEventsData({
      ensureRange,
      getEvents,
      loading: false,
      revision: 2,
    })).toMatchObject({
      ensureRange,
      getEvents,
      loading: false,
      revision: 2,
      editable: true,
    });
  });
});
