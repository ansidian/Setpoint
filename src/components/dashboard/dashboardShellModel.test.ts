import { describe, expect, it } from "vitest";
import {
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  dashboardEventCalendarRequest, resolveCalendarOpenState,
  resolveDashboardShellHotkey,
  resolveShellTabHotkey,
  resolveNotesNavigationChord
} from "./dashboardShellModel";

describe("dashboard shell model", () => {
  it("normalizes calendar open requests without rendering DashboardShell", () => {
    // Phase 4: the calendar is reachable on mobile, so deep-links resolve (no longer null).
    expect(resolveCalendarOpenState({
      isMobile: true,
      viewKey: "events",
    })).toMatchObject({ view: "events" });

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
      eventCreateRequest: null,
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

  it("routes a typed event create request to Calendar create mode unchanged", () => {
    const eventCreateRequest = {
      seed: {
        title: "Planning",
        allDay: false,
        startDate: "2026-09-10",
        startTime: "09:00",
        endTime: "09:30",
      },
      origin: { kind: "test", referenceId: "request-1" },
    };

    expect(resolveCalendarOpenState({
      viewKey: "bills",
      currentView: "bills",
      showBills: true,
      focusDate: "2026-01-01",
      focusItemId: "old-item",
      options: { eventCreateRequest },
    })).toMatchObject({
      view: "events",
      focusDate: "2026-09-10",
      focusItemId: "new",
      focusOpenDetail: false,
      eventCreateRequest,
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

    expect(dashboardEventCalendarRequest("2026-04-21", "event-1")).toEqual({
      viewKey: "events",
      focusDate: "2026-04-21",
      focusItemId: "event-1",
      options: {
        source: "dashboard",
        openDetail: true,
        forceEventOverlay: true,
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

  it("ignores single-key shell commands already claimed by a focused workspace", () => {
    expect(resolveDashboardShellHotkey({ key: "a", defaultPrevented: true }))
      .toEqual({ action: "ignore" });
  });

  describe("blocking-overlay gating (P3-26 / P3-27)", () => {
    it("suppresses single-key shell commands behind a blocking overlay that isn't their target (e.g. Customize)", () => {
      // analyticsOpen/historyOpen are false here, modelling a Customize panel open:
      // every single-key command would open a surface *behind* it, so all are ignored.
      for (const key of ["a", "c", "y", "g"]) {
        expect(resolveDashboardShellHotkey({ key, anyBlockingOverlayOpen: true }))
          .toEqual({ action: "ignore" });
      }
    });

    it("still allows the toggle that CLOSES the foreground overlay (a→Analytics, y→History)", () => {
      // The `a`/`y` toggles only ever dismiss the overlay that's already open, like
      // Escape, so they must keep working even while that overlay blocks the shell.
      expect(resolveDashboardShellHotkey({
        key: "a", anyBlockingOverlayOpen: true, analyticsOpen: true,
      })).toEqual({ action: "toggle-analytics" });
      expect(resolveDashboardShellHotkey({
        key: "y", anyBlockingOverlayOpen: true, historyOpen: true,
      })).toEqual({ action: "toggle-history" });
      // But a command targeting a DIFFERENT surface stays suppressed: `c` must not
      // open the calendar behind the open Analytics modal.
      expect(resolveDashboardShellHotkey({
        key: "c", anyBlockingOverlayOpen: true, analyticsOpen: true,
      })).toEqual({ action: "ignore" });
      // And `a` must not open Analytics behind a non-Analytics overlay (History open).
      expect(resolveDashboardShellHotkey({
        key: "a", anyBlockingOverlayOpen: true, historyOpen: true,
      })).toEqual({ action: "ignore" });
    });

    it("clears an in-flight g-chord instead of firing it while an overlay is open", () => {
      expect(resolveDashboardShellHotkey({
        key: "t",
        actionChord: "g",
        anyBlockingOverlayOpen: true,
      })).toEqual({ action: "clear-chord" });
    });

    it("keeps ⌘K and Alfred ⌘\\ working over a blocking overlay (Escape is never a command)", () => {
      expect(resolveDashboardShellHotkey({ key: "k", metaKey: true, anyBlockingOverlayOpen: true }))
        .toEqual({ action: "open-palette" });
      expect(resolveDashboardShellHotkey({
        key: "\\", code: "Backslash", metaKey: true, anyBlockingOverlayOpen: true,
      })).toEqual({ action: "toggle-alfred" });
      expect(resolveDashboardShellHotkey({
        key: "|", code: "Backslash", metaKey: true, shiftKey: true, anyBlockingOverlayOpen: true,
      })).toEqual({ action: "alfred-new-chat" });
      // Escape carries no command here, so it falls through and the overlay's own
      // handler can still close it.
      expect(resolveDashboardShellHotkey({ key: "Escape", anyBlockingOverlayOpen: true }))
        .toEqual({ action: "ignore" });
    });

    it("maps unmodified 1-5 keys to their tabs", () => {
      expect(["1", "2", "3", "4", "5"].map((key) => resolveShellTabHotkey({ key })))
        .toEqual(["dashboard", "inbox", "calendar", "notes", "news"]);
    });

    it("suppresses tab switches from overlays, editable targets, and modified keys", () => {
      for (const key of ["1", "2", "3", "4", "5"]) {
        expect(resolveShellTabHotkey({ key, anyBlockingOverlayOpen: true })).toBeNull();
      }
      expect(resolveShellTabHotkey({ key: "1", editableTarget: true })).toBeNull();
      expect(resolveShellTabHotkey({ key: "1", metaKey: true })).toBeNull();
    });

    it("uses a backtick leader to route number keys away from Notes", () => {
      expect(resolveNotesNavigationChord({
        key: "`", code: "Backquote", activeTab: "notes",
      })).toEqual({ action: "start" });
      expect(["1", "2", "3", "4", "5"].map((key) => resolveNotesNavigationChord({
        key,
        code: `Digit${key}`,
        leaderActive: true,
        activeTab: "notes",
      }))).toEqual([
        { action: "navigate", tab: "dashboard" },
        { action: "navigate", tab: "inbox" },
        { action: "navigate", tab: "calendar" },
        { action: "navigate", tab: "notes" },
        { action: "navigate", tab: "news" },
      ]);
    });

    it("keeps the Notes leader scoped and cancellable", () => {
      expect(resolveNotesNavigationChord({ key: "1", code: "Digit1", activeTab: "notes" }))
        .toEqual({ action: "ignore" });
      expect(resolveNotesNavigationChord({ key: "Escape", leaderActive: true, activeTab: "notes" }))
        .toEqual({ action: "cancel" });
      expect(resolveNotesNavigationChord({
        key: "`", code: "Backquote", activeTab: "dashboard",
      })).toEqual({ action: "ignore" });
      expect(resolveNotesNavigationChord({
        key: "`", code: "Backquote", activeTab: "notes", anyBlockingOverlayOpen: true,
      })).toEqual({ action: "ignore" });
    });
  });

  describe("alfred hotkeys", () => {
    it("toggles alfred on cmd+backslash even from an editable target", () => {
      expect(resolveDashboardShellHotkey({
        key: "\\", code: "Backslash", metaKey: true, editableTarget: true,
      })).toEqual({ action: "toggle-alfred" });
      expect(resolveDashboardShellHotkey({
        key: "\\", code: "Backslash", ctrlKey: true,
      })).toEqual({ action: "toggle-alfred" });
    });

    it("starts a new chat on cmd+shift+backslash (key reports as | on US layouts)", () => {
      expect(resolveDashboardShellHotkey({
        key: "|", code: "Backslash", metaKey: true, shiftKey: true, editableTarget: true,
      })).toEqual({ action: "alfred-new-chat" });
    });

    it("ignores Alfred shortcuts on mobile", () => {
      expect(resolveDashboardShellHotkey({
        key: "\\", code: "Backslash", metaKey: true, isMobile: true,
      })).toEqual({ action: "ignore" });
      expect(resolveDashboardShellHotkey({
        key: "|", code: "Backslash", metaKey: true, shiftKey: true, isMobile: true,
      })).toEqual({ action: "ignore" });
    });
  });
});
