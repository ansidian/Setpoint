import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel.js";

export function resolveCalendarOpenState({
  viewKey = null,
  currentView = "events",
  showBills = false,
  focusDate = null,
  focusItemId = null,
  options = {},
} = {}) {
  const requested = viewKey ? normalizeCalendarWorkspaceView(viewKey) : null;
  const fallbackView = normalizeCalendarWorkspaceView(currentView);
  const view = requested === "bills" && !showBills
    ? "events"
    : requested || fallbackView;
  const nextFocusItemId = focusItemId ? String(focusItemId) : null;
  const forceDeadlineOverlay = !!options.forceDeadlineOverlay;
  const forceEventOverlay = !!options.forceEventOverlay;
  const forceCompletedDeadlineOverlay = !!options.forceCompletedDeadlineOverlay;
  return {
    view,
    focusDate: focusDate || null,
    focusItemId: nextFocusItemId,
    focusOpenDetail: !!options.openDetail && !!nextFocusItemId && nextFocusItemId !== "new",
    forceEventOverlay,
    forceDeadlineOverlay,
    forceCompletedDeadlineOverlay,
    shouldLoadDeadlines: forceDeadlineOverlay,
    shouldLoadBills: view === "bills",
  };
}

export function deadlineOccurrenceFocusId(taskOrId, dateKey) {
  const id = typeof taskOrId === "object" ? taskOrId?.id : taskOrId;
  const dueDate = typeof taskOrId === "object" ? taskOrId?.due_date : dateKey;
  if (!id) return null;
  const stringId = String(id);
  if (stringId.startsWith("deadline:")) return stringId;
  if (!dueDate) return stringId;
  return `deadline:${stringId}:${dueDate}`;
}

export function dashboardDeadlineCalendarRequest(taskOrId, dateKey) {
  const focusItemId = deadlineOccurrenceFocusId(taskOrId, dateKey);
  const focusDate = typeof taskOrId === "object" ? taskOrId?.due_date : dateKey;
  return {
    viewKey: "events",
    focusDate: focusDate || null,
    focusItemId,
    options: {
      source: "dashboard",
      openDetail: !!focusItemId,
      forceDeadlineOverlay: true,
      forceCompletedDeadlineOverlay: !!focusItemId,
    },
  };
}

export function dashboardBillCalendarRequest(date, itemId) {
  return {
    viewKey: "bills",
    focusDate: date || null,
    focusItemId: itemId || null,
    options: {
      source: "dashboard",
      openDetail: !!itemId,
    },
  };
}

// A dashboard deep-link forces calendar overlays on and focuses an item for that
// one navigation. The forced overlays + focus must be dropped when the user leaves
// the calendar tab, so a later manual return can't resurrect the stale detail.
// This is the pure leave-detection the shell effect keys on: true only on a
// calendar → non-calendar transition (every leave path — header tabs, hotkeys,
// mobile fallback, back — funnels through the same `tab` change).
export function shouldClearCalendarFocusOnLeave({ prevTab, tab } = {}) {
  return prevTab === "calendar" && tab !== "calendar";
}

export function resolveDashboardShellHotkey({
  key,
  code = "",
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  repeat = false,
  editableTarget = false,
  actionChord = null,
  anyBlockingOverlayOpen = false,
  analyticsOpen = false,
  historyOpen = false,
} = {}) {
  // Alfred hotkeys fire everywhere, including editable targets and while a
  // blocking overlay is open, so the panel can be toggled from its own composer
  // (CONTEXT.md: ⌘\ toggle, ⌘⇧\ new chat).
  if ((metaKey || ctrlKey) && code === "Backslash") {
    return { action: shiftKey ? "alfred-new-chat" : "toggle-alfred" };
  }
  if (editableTarget) return { action: "clear-chord" };
  const normalized = String(key || "").toLowerCase();

  // ⌘K command palette must keep working over any overlay; it is the global
  // entry point and overlays close themselves on Escape (their own handlers).
  if ((metaKey || ctrlKey) && normalized === "k") return { action: "open-palette" };
  if (repeat || metaKey || ctrlKey || altKey) return { action: "ignore" };

  // P3-26: when a non-input blocking overlay (Analytics / Customize / History)
  // is open, suppress single-key commands that would open calendar/analytics/
  // snapshots/deadline overlays *behind* the modal. The one exception is the
  // toggle that CLOSES the overlay currently in the foreground (`a` while
  // Analytics is open, `y` while History is open) — like Escape, it only ever
  // dismisses, never opens-behind. Everything else (incl. an in-flight g-chord,
  // `c`, or a toggle whose overlay is NOT the open one) is ignored. ⌘K/⌘\ are
  // handled above and Escape is never a command here.
  if (anyBlockingOverlayOpen) {
    if (actionChord === "g") return { action: "clear-chord" };
    if (normalized === "a" && analyticsOpen) return { action: "toggle-analytics" };
    if (normalized === "y" && historyOpen) return { action: "toggle-history" };
    return { action: "ignore" };
  }

  if (actionChord === "g") {
    if (normalized === "t") return { action: "open-deadline-create", clearChord: true };
    if (normalized === "e" || normalized === "c") {
      return { action: "open-event-create", clearChord: true };
    }
    return { action: "clear-chord" };
  }

  if (normalized === "g") return { action: "start-g-chord" };
  if (normalized === "a") return { action: "toggle-analytics" };
  if (normalized === "y") return { action: "toggle-history" };
  return { action: "ignore" };
}

// P3-27: pure resolver for ShellHeader's 1/2 tab hotkeys. Suppressed while a
// blocking overlay (Customize / Analytics / History) is open so the underlying
// shell tab can't desync from the visible overlay. Keeps the same input guards
// as the single-key shell commands (editable targets and meta combos pass).
export function resolveShellTabHotkey({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  editableTarget = false,
  anyBlockingOverlayOpen = false,
} = {}) {
  if (editableTarget) return null;
  if (metaKey || ctrlKey || altKey) return null;
  if (anyBlockingOverlayOpen) return null;
  if (key === "1") return "dashboard";
  if (key === "2") return "inbox";
  if (key === "3") return "calendar";
  if (key === "4") return "notes";
  return null;
}

export function buildDashboardEventsData(calendarRange = {}) {
  return {
    ensureRange: calendarRange.ensureRange,
    refreshRange: calendarRange.refreshRange,
    refreshRangeInPlace: calendarRange.refreshRangeInPlace,
    upsertEvents: calendarRange.upsertEvents,
    removeEvent: calendarRange.removeEvent,
    getEvents: calendarRange.getEvents,
    hasMonth: calendarRange.hasMonth,
    isMonthLoading: calendarRange.isMonthLoading,
    loading: calendarRange.loading,
    staleRefreshPending: calendarRange.staleRefreshPending,
    error: calendarRange.error,
    revision: calendarRange.revision,
    cacheStamp: calendarRange.cacheStamp,
    editable: true,
  };
}
