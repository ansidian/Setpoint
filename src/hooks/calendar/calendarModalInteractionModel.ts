import type { CalendarView } from "../../../shared/types/calendar";

export const DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsDeadlineOverlay";
export const COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsCompletedDeadlines";

export interface CalendarStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

export interface DashboardDetailFocusRequest {
  openRequestId: number;
  view: CalendarView;
  detailKind?: "deadline";
  anchorKind?: "grid-chip";
  dateKey: string;
  itemId: string;
  requestKey: string;
  attempts: number;
}

export function normalizeCalendarWorkspaceView(_view: unknown, _fallback: unknown = "events"): CalendarView {
  return "events";
}

export function readStoredBoolean(
  storage: Pick<CalendarStorageAdapter, "getItem"> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
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

export function writeStoredBoolean(
  storage: Pick<CalendarStorageAdapter, "setItem"> | null | undefined,
  key: string,
  value: boolean,
): void {
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
}: { open?: boolean; view?: unknown; focusItemId?: unknown; forceDeadlineOverlay?: boolean }): boolean {
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
}: {
  open?: boolean;
  view?: unknown;
  focusItemId?: unknown;
  focusDate?: string | null;
  forceDeadlineOverlay?: boolean;
  todayDateKey?: string | null;
}): { mode: "create"; seedDate: string | null } | null {
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
}: { open?: boolean; view?: unknown; forceDeadlineOverlay?: boolean }): boolean {
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
}: {
  open?: boolean;
  focusOpenDetail?: boolean;
  focusItemId?: unknown;
  focusDate?: string | null;
  activeSelectedDateKey?: string | null;
  openRequestId?: number;
  usesFloatingEditor?: boolean;
  view?: unknown;
  forceDeadlineOverlay?: boolean;
}): DashboardDetailFocusRequest | null {
  if (!open || !focusOpenDetail || !focusItemId || focusItemId === "new" || !usesFloatingEditor) {
    return null;
  }
  const dateKey = focusDate || activeSelectedDateKey;
  if (!dateKey) return null;
  const itemId = String(focusItemId);
  const normalizedView = normalizeCalendarWorkspaceView(view);
  const detailKind = normalizedView === "events" && forceDeadlineOverlay ? "deadline" : null;
  const anchorKind = normalizedView === "bills" ? "grid-chip" : null;
  return {
    openRequestId,
    view: normalizedView,
    ...(detailKind ? { detailKind } : {}),
    ...(anchorKind ? { anchorKind } : {}),
    dateKey,
    itemId,
    requestKey: `${openRequestId}:${normalizedView}:${detailKind || "item"}:${dateKey}:${itemId}`,
    attempts: 0,
  };
}
