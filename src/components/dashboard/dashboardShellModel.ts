import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel";
import type { CalendarView } from "../../../shared/types/calendar";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { RefObject } from "react";

export type DashboardTab = "dashboard" | "inbox" | "calendar" | "notes" | "news";
export type DashboardGlanceSheet = {
  kind: "deadline" | "bill" | "event";
  item?: DashboardDeadline | Record<string, unknown>;
  itemId?: string | number | null;
  date?: string | null;
  anchorRef?: RefObject<unknown>;
};
export interface CalendarOpenOptions {
  source?: string;
  openDetail?: boolean;
  forceDeadlineOverlay?: boolean;
  forceEventOverlay?: boolean;
  forceCompletedDeadlineOverlay?: boolean;
}
export interface CalendarOpenRequest {
  viewKey: CalendarView;
  focusDate: string | null;
  focusItemId: string | null;
  options: CalendarOpenOptions;
}
type DeadlineFocusInput = string | number | (Partial<DashboardDeadline> & { id?: string | number; due_date?: string | null });

export function resolveCalendarOpenState({
  viewKey = null,
  currentView = "events",
  showBills = false,
  focusDate = null,
  focusItemId = null,
  options = {},
}: {
  viewKey?: string | null;
  isMobile?: boolean;
  currentView?: string;
  showBills?: boolean;
  focusDate?: string | null;
  focusItemId?: string | number | null;
  options?: CalendarOpenOptions;
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

export function deadlineOccurrenceFocusId(taskOrId: DeadlineFocusInput, dateKey?: string | null) {
  const id = typeof taskOrId === "object" ? taskOrId?.id : taskOrId;
  const dueDate = typeof taskOrId === "object" ? taskOrId?.due_date : dateKey;
  if (!id) return null;
  const stringId = String(id);
  if (stringId.startsWith("deadline:")) return stringId;
  if (!dueDate) return stringId;
  return `deadline:${stringId}:${dueDate}`;
}

export function dashboardDeadlineCalendarRequest(taskOrId: DeadlineFocusInput, dateKey?: string | null): CalendarOpenRequest {
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

export function dashboardBillCalendarRequest(date?: string | null, itemId?: string | number | null): CalendarOpenRequest {
  return {
    viewKey: "bills",
    focusDate: date || null,
    focusItemId: itemId ? String(itemId) : null,
    options: {
      source: "dashboard",
      openDetail: !!itemId,
    },
  };
}

// Identity key for a glance-sheet descriptor. Bills and events carry an explicit
// itemId; deadlines carry the task object (keyed by its id). One key fn so a
// re-tap of the same card toggles the sheet shut for every kind — not only
// deadlines, which were the sole kind wired for toggle before.
function itemSheetKey(sheet: DashboardGlanceSheet | null) {
  if (!sheet) return null;
  if (sheet.itemId != null) return String(sheet.itemId);
  if (sheet.item?.id != null) return String(sheet.item.id);
  return null;
}

// Resolve the next glance-sheet state for a dashboard item tap: re-tapping the
// card whose sheet is already open closes it (toggle); tapping a different item —
// or a different kind — swaps to the new one. A tap with no resolvable identity
// always opens, since we cannot prove it is the same item.
export function nextItemSheet(prev: DashboardGlanceSheet | null, next: DashboardGlanceSheet | null) {
  if (!next) return null;
  const nextKey = itemSheetKey(next);
  if (prev && prev.kind === next.kind && nextKey != null && itemSheetKey(prev) === nextKey) {
    return null;
  }
  return next;
}

// A dashboard deep-link forces calendar overlays on and focuses an item for that
// one navigation. The forced overlays + focus must be dropped when the user leaves
// the calendar tab, so a later manual return can't resurrect the stale detail.
// This is the pure leave-detection the shell effect keys on: true only on a
// calendar → non-calendar transition (every leave path — header tabs, hotkeys,
// mobile fallback, back — funnels through the same `tab` change).
export function shouldClearCalendarFocusOnLeave({ prevTab, tab }: { prevTab?: DashboardTab; tab?: DashboardTab } = {}) {
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
}: {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  editableTarget?: boolean;
  actionChord?: string | null;
  anyBlockingOverlayOpen?: boolean;
  analyticsOpen?: boolean;
  historyOpen?: boolean;
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
}: {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  editableTarget?: boolean;
  anyBlockingOverlayOpen?: boolean;
} = {}): DashboardTab | null {
  if (editableTarget) return null;
  if (metaKey || ctrlKey || altKey) return null;
  if (anyBlockingOverlayOpen) return null;
  if (key === "1") return "dashboard";
  if (key === "2") return "inbox";
  if (key === "3") return "calendar";
  if (key === "4") return "notes";
  if (key === "5") return "news";
  return null;
}

export interface DashboardCalendarRangeAdapter {
  ensureRange?: unknown;
  refreshRange?: unknown;
  refreshRangeInPlace?: unknown;
  upsertEvents?: unknown;
  removeEvent?: unknown;
  markStale?: unknown;
  getEvents?: unknown;
  hasMonth?: unknown;
  isMonthLoading?: unknown;
  loading?: boolean;
  staleRefreshPending?: boolean;
  error?: unknown;
  revision?: number;
  cacheStamp?: number;
}

export function buildDashboardEventsData(calendarRange: DashboardCalendarRangeAdapter = {}) {
  return {
    ensureRange: calendarRange.ensureRange,
    refreshRange: calendarRange.refreshRange,
    refreshRangeInPlace: calendarRange.refreshRangeInPlace,
    upsertEvents: calendarRange.upsertEvents,
    removeEvent: calendarRange.removeEvent,
    markStale: calendarRange.markStale,
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
