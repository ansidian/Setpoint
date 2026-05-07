export function resolveCalendarOpenState({
  isMobile = false,
  viewKey = null,
  currentView = "events",
  showBills = false,
  focusDate = null,
  focusItemId = null,
  options = {},
} = {}) {
  if (isMobile) return null;
  const requested = viewKey === "deadlines" ? "events" : viewKey;
  const view = requested === "bills" && !showBills
    ? "events"
    : requested || currentView;
  const nextFocusItemId = focusItemId ? String(focusItemId) : null;
  const forceDeadlineOverlay = !!options.forceDeadlineOverlay;
  return {
    view,
    focusDate: focusDate || null,
    focusItemId: nextFocusItemId,
    focusOpenDetail: !!options.openDetail && !!nextFocusItemId && nextFocusItemId !== "new",
    forceDeadlineOverlay,
    shouldLoadDeadlines: forceDeadlineOverlay,
    shouldLoadBills: view === "bills",
  };
}

export function resolveDashboardShellHotkey({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  repeat = false,
  editableTarget = false,
  actionChord = null,
  calendarOpen = false,
} = {}) {
  if (editableTarget) return { action: "clear-chord" };
  const normalized = String(key || "").toLowerCase();

  if ((metaKey || ctrlKey) && normalized === "k") return { action: "open-palette" };
  if (repeat || metaKey || ctrlKey || altKey) return { action: "ignore" };

  if (actionChord === "g") {
    if (normalized === "t") return { action: "open-todoist-create", clearChord: true };
    if (normalized === "e" || normalized === "c") {
      return { action: "open-event-create", clearChord: true };
    }
    return { action: "clear-chord" };
  }

  if (normalized === "g") return { action: "start-g-chord" };
  if (normalized === "a") return { action: "toggle-analytics" };
  if (normalized === "c" && !calendarOpen) return { action: "open-calendar" };
  if (normalized === "y") return { action: "toggle-history" };
  return { action: "ignore" };
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
    editable: true,
  };
}
