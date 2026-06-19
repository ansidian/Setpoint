export const DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsDeadlineOverlay";
export const COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsCompletedDeadlines";

export function normalizeCalendarWorkspaceView(view, fallback = "events") {
  if (view === "events" || view === "bills") return view;
  return fallback === "bills" ? "bills" : "events";
}

// Cycle the active calendar view. `views` is the availability-ordered list
// (e.g. ["events","bills"] when Actual Budget is configured, else ["events"]).
export function nextCalendarView({ current, views, reverse = false } = {}) {
  if (!Array.isArray(views) || views.length < 2) return current;
  const idx = views.indexOf(current);
  if (idx === -1) return current;
  const step = reverse ? -1 : 1;
  return views[(idx + step + views.length) % views.length];
}

export function readStoredBoolean(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    const value = storage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return fallback;
  }
  return fallback;
}

export function writeStoredBoolean(storage, key, value) {
  if (!storage) return;
  try {
    storage.setItem(key, value ? "true" : "false");
  } catch {
    // Stored calendar preferences are an enhancement.
  }
}

export function isDeadlineCreateFocusRequest({
  open,
  view,
  focusItemId,
  forceDeadlineOverlay = false,
}) {
  return !!open
    && focusItemId === "new"
    && view === "events"
    && !!forceDeadlineOverlay;
}

export function initialDeadlineEditorState({
  open,
  view,
  focusItemId,
  focusDate = null,
  forceDeadlineOverlay = false,
  todayDateKey = null,
}) {
  if (!isDeadlineCreateFocusRequest({ open, view, focusItemId, forceDeadlineOverlay })) {
    return null;
  }
  return {
    mode: "create",
    seedDate: focusDate || (view === "events" && forceDeadlineOverlay ? todayDateKey : null),
  };
}

export function shouldForceDeadlineOverlay({
  open,
  view,
  forceDeadlineOverlay = false,
}) {
  return !!open && view === "events" && !!forceDeadlineOverlay;
}

export function dashboardDetailFocusRequest({
  open,
  focusOpenDetail = false,
  focusItemId,
  focusDate = null,
  activeSelectedDateKey = null,
  openRequestId = 0,
  usesFloatingEditor = false,
  view,
  forceDeadlineOverlay = false,
}) {
  if (!open || !focusOpenDetail || !focusItemId || focusItemId === "new" || !usesFloatingEditor) {
    return null;
  }
  const dateKey = focusDate || activeSelectedDateKey;
  if (!dateKey) return null;
  const itemId = String(focusItemId);
  const detailKind = view === "events" && forceDeadlineOverlay ? "deadline" : null;
  return {
    openRequestId,
    view: normalizeCalendarWorkspaceView(view),
    ...(detailKind ? { detailKind } : {}),
    dateKey,
    itemId,
    requestKey: `${openRequestId}:${normalizeCalendarWorkspaceView(view)}:${detailKind || "item"}:${dateKey}:${itemId}`,
    attempts: 0,
  };
}

