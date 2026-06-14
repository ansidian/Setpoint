import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel.js";

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
    if (normalized === "t") return { action: "open-deadline-create", clearChord: true };
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
    cacheStamp: calendarRange.cacheStamp,
    editable: true,
  };
}
