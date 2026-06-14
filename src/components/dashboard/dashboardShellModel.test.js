import { describe, expect, it } from "vitest";
import {
  buildDashboardEventsData,
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  resolveCalendarOpenState,
  resolveDashboardShellHotkey,
} from "./dashboardShellModel.js";

describe("dashboard shell model", () => {
  it("normalizes calendar open requests without rendering DashboardShell", () => {
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
      forceEventOverlay: false,
      forceDeadlineOverlay: true,
      forceCompletedDeadlineOverlay: false,
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

    expect(resolveCalendarOpenState({
      isMobile: false,
      viewKey: null,
      currentView: "deadlines",
      showBills: true,
    })).toMatchObject({
      view: "events",
      shouldLoadBills: false,
    });
  });

  it("resolves shell hotkeys and g-chords as commands", () => {
    expect(resolveDashboardShellHotkey({ key: "k", metaKey: true })).toEqual({ action: "open-palette" });
    expect(resolveDashboardShellHotkey({ key: "g" })).toEqual({ action: "start-g-chord" });
    expect(resolveDashboardShellHotkey({ key: "t", actionChord: "g" })).toEqual({
      action: "open-deadline-create",
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

  it("builds dashboard deadline and bill calendar requests through stable shell commands", () => {
    expect(dashboardDeadlineCalendarRequest({
      id: "todo-42",
      due_date: "2026-04-20",
    })).toEqual({
      viewKey: "events",
      focusDate: "2026-04-20",
      focusItemId: "deadline:todo-42:2026-04-20",
      options: {
        source: "dashboard",
        openDetail: true,
        forceDeadlineOverlay: true,
        forceCompletedDeadlineOverlay: true,
      },
    });

    expect(dashboardDeadlineCalendarRequest(
      "deadline:todo-42:2026-04-20",
      "2026-04-21",
    )).toMatchObject({
      viewKey: "events",
      focusDate: "2026-04-21",
      focusItemId: "deadline:todo-42:2026-04-20",
      options: {
        openDetail: true,
        forceDeadlineOverlay: true,
      },
    });

    expect(dashboardBillCalendarRequest("2026-04-20", "bill-rent")).toEqual({
      viewKey: "bills",
      focusDate: "2026-04-20",
      focusItemId: "bill-rent",
      options: {
        source: "dashboard",
        openDetail: true,
      },
    });
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

  it("forwards the cache stamp so modal memos invalidate when event content changes", () => {
    expect(buildDashboardEventsData({ cacheStamp: 7 }).cacheStamp).toBe(7);
  });
});
