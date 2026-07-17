import { describe, expect, it } from "vitest";
import {
  buildDashboardEventsData,
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  nextItemSheet,
  resolveCalendarOpenState,
  resolveDashboardShellHotkey,
  resolveShellTabHotkey,
  shouldClearCalendarFocusOnLeave,
} from "./dashboardShellModel";
import type { DashboardGlanceSheet } from "./dashboardShellModel";

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
    expect(resolveDashboardShellHotkey({ key: "a" })).toEqual({ action: "toggle-analytics" });
    expect(resolveDashboardShellHotkey({ key: "y" })).toEqual({ action: "toggle-history" });
  });

  it("no longer maps 'c' to open-calendar", () => {
    expect(resolveDashboardShellHotkey({ key: "c" }).action).toBe("ignore");
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

  it("forwards markStale so failed mutations can re-converge the month cache", () => {
    const markStale = () => {};
    expect(buildDashboardEventsData({ markStale }).markStale).toBe(markStale);
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

    it("resolves 1/2/3 tab switches only when no blocking overlay is open", () => {
      expect(resolveShellTabHotkey({ key: "1" })).toBe("dashboard");
      expect(resolveShellTabHotkey({ key: "2" })).toBe("inbox");
      expect(resolveShellTabHotkey({ key: "1", anyBlockingOverlayOpen: true })).toBeNull();
      expect(resolveShellTabHotkey({ key: "2", anyBlockingOverlayOpen: true })).toBeNull();
      expect(resolveShellTabHotkey({ key: "1", editableTarget: true })).toBeNull();
      expect(resolveShellTabHotkey({ key: "1", metaKey: true })).toBeNull();
    });

    it("maps '3' to calendar", () => {
      expect(resolveShellTabHotkey({ key: "3" })).toBe("calendar");
    });

    it("suppresses '3' while a blocking overlay is open", () => {
      expect(resolveShellTabHotkey({ key: "3", anyBlockingOverlayOpen: true })).toBeNull();
    });

    it("maps '4' to notes", () => {
      expect(resolveShellTabHotkey({ key: "4" })).toBe("notes");
    });

    it("resolves hotkey 5 to the news tab", () => {
      expect(resolveShellTabHotkey({ key: "5" })).toBe("news");
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

    it("plain backslash still does nothing", () => {
      expect(resolveDashboardShellHotkey({ key: "\\", code: "Backslash" }))
        .toEqual({ action: "ignore" });
    });
  });

  describe("nextItemSheet", () => {
    it("closes an open event sheet when the same card is re-tapped (the events toggle bug)", () => {
      const open: DashboardGlanceSheet = { kind: "event", item: { title: "Standup" }, itemId: "evt-1" };
      const reTap: DashboardGlanceSheet = { kind: "event", item: { title: "Standup" }, itemId: "evt-1", anchorRef: { current: {} } };
      expect(nextItemSheet(open, reTap)).toBeNull();
    });

    it("closes an open bill sheet when the same card is re-tapped (same toggle bug)", () => {
      const open: DashboardGlanceSheet = { kind: "bill", item: { name: "Electric" }, itemId: "bill-1" };
      const reTap: DashboardGlanceSheet = { kind: "bill", item: { name: "Electric" }, itemId: "bill-1" };
      expect(nextItemSheet(open, reTap)).toBeNull();
    });

    it("still toggles deadlines shut, keyed by the task id (unchanged behavior)", () => {
      const open: DashboardGlanceSheet = { kind: "deadline", item: { id: "t1", title: "Report" } };
      const reTap: DashboardGlanceSheet = { kind: "deadline", item: { id: "t1", title: "Report" } };
      expect(nextItemSheet(open, reTap)).toBeNull();
    });

    it("swaps to a different item of the same kind instead of closing", () => {
      const open: DashboardGlanceSheet = { kind: "event", itemId: "evt-1" };
      const other: DashboardGlanceSheet = { kind: "event", itemId: "evt-2" };
      expect(nextItemSheet(open, other)).toBe(other);
    });

    it("swaps when the kind changes even if the keys happen to collide", () => {
      const open: DashboardGlanceSheet = { kind: "deadline", item: { id: "x" } };
      const other: DashboardGlanceSheet = { kind: "bill", itemId: "x" };
      expect(nextItemSheet(open, other)).toBe(other);
    });

    it("opens when nothing is currently open", () => {
      const next: DashboardGlanceSheet = { kind: "event", itemId: "evt-1" };
      expect(nextItemSheet(null, next)).toBe(next);
    });

    it("opens (cannot toggle) when the tapped item has no resolvable identity", () => {
      const open: DashboardGlanceSheet = { kind: "event", item: {} };
      const reTap: DashboardGlanceSheet = { kind: "event", item: {} };
      expect(nextItemSheet(open, reTap)).toBe(reTap);
    });
  });

  describe("shouldClearCalendarFocusOnLeave", () => {
    it("clears when leaving the calendar tab", () => {
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "calendar", tab: "dashboard" })).toBe(true);
    });

    it("clears on every leave path, not just calendar → dashboard", () => {
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "calendar", tab: "inbox" })).toBe(true);
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "calendar", tab: "notes" })).toBe(true);
    });

    it("does not clear while staying on the calendar tab", () => {
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "calendar", tab: "calendar" })).toBe(false);
    });

    it("does not clear when arriving at the calendar tab", () => {
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "dashboard", tab: "calendar" })).toBe(false);
    });

    it("does not clear when moving between two non-calendar tabs", () => {
      expect(shouldClearCalendarFocusOnLeave({ prevTab: "dashboard", tab: "notes" })).toBe(false);
    });
  });
});
