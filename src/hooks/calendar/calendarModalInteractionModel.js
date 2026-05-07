export const DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsDeadlineOverlay";
export const COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsCompletedDeadlines";

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
    && (
      view === "deadlines"
      || (view === "events" && forceDeadlineOverlay)
    );
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
}) {
  if (!open || !focusOpenDetail || !focusItemId || focusItemId === "new" || !usesFloatingEditor) {
    return null;
  }
  const dateKey = focusDate || activeSelectedDateKey;
  if (!dateKey) return null;
  const itemId = String(focusItemId);
  return {
    openRequestId,
    view,
    dateKey,
    itemId,
    requestKey: `${openRequestId}:${view}:${dateKey}:${itemId}`,
    attempts: 0,
  };
}

export function floatingWorkspaceNavigationEffect({
  currentFloating,
  eventEditorOpen = false,
  deadlineEditorMode = null,
}) {
  const floatingEditorOpen = !!currentFloating?.open
    && (currentFloating.mode === "edit" || currentFloating.mode === "create");
  const preserveEditor = !!eventEditorOpen || !!deadlineEditorMode || floatingEditorOpen;
  return {
    preserveEditor,
    shouldParkFloatingEditor: floatingEditorOpen,
    shouldParkFloatingDetail: !preserveEditor && !!currentFloating?.open,
    shouldClearSelection: !preserveEditor && !currentFloating?.open,
  };
}
