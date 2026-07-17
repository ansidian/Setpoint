import type { CurrentDashboardEventInput } from "../../shared/types/dashboard";
import type { CalendarView } from "../../shared/types/calendar";

interface SyncHotkeyEvent {
  key?: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: { isContentEditable?: boolean; tagName?: string } | null;
}

interface DashboardCalendarWorkspace {
  open?: boolean;
  view?: CalendarView;
  eventsRange?: { start?: string | null; end?: string | null } | null;
}

export type DashboardRefreshTrigger = "timer" | "explicit";

export function shouldTriggerSyncHotkey(
  event: SyncHotkeyEvent = {},
  { refreshing = false, syncing = false }: { refreshing?: boolean; syncing?: boolean } = {},
): boolean {
  return (
    event.key === "r"
    && !refreshing
    && !syncing
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.target?.isContentEditable
    && event.target?.tagName !== "INPUT"
    && event.target?.tagName !== "TEXTAREA"
    && event.target?.tagName !== "SELECT"
  );
}

export function resolveDashboardRefreshPlan({
  trigger = "timer",
  currentSyncing = false,
  calendarWorkspace = {},
}: {
  trigger?: DashboardRefreshTrigger;
  currentSyncing?: boolean;
  calendarWorkspace?: DashboardCalendarWorkspace;
} = {}) {
  if (currentSyncing) {
    return { shouldRun: false };
  }

  const explicit = trigger === "explicit";
  const eventsRange = calendarWorkspace?.eventsRange;
  const shouldRefreshVisibleEvents = !!(
    explicit
    && calendarWorkspace?.open
    && calendarWorkspace?.view === "events"
    && eventsRange?.start
    && eventsRange?.end
  );

  return {
    shouldRun: true,
    syncActiveSnapshot: true,
    refreshVisibleEvents: shouldRefreshVisibleEvents
      ? { start: eventsRange!.start!, end: eventsRange!.end! }
      : null,
    markCalendarEventsStale: explicit && !shouldRefreshVisibleEvents,
    markDeadlineRangeStale: explicit,
    markBillRangeStale: explicit,
    markBillsRefreshRequested: explicit,
    refreshCalendarDomains: explicit ? { force: true, includeBills: true } : null,
  };
}

export function resolveDashboardCurrentEventPlan(event: CurrentDashboardEventInput = {}) {
  const source = event?.source;
  if (source === "bills") {
    return {
      markBillsRefreshRequested: true,
      markBillRangeStale: true,
      markDeadlineRangeStale: false,
      refreshCalendarDomains: null,
    };
  }
  if (source === "todoist") {
    return {
      markBillsRefreshRequested: false,
      markBillRangeStale: false,
      markDeadlineRangeStale: true,
      refreshCalendarDomains: event.state === "current"
        ? { force: true, includeBills: false }
        : null,
    };
  }
  return {
    markBillsRefreshRequested: false,
    markBillRangeStale: false,
    markDeadlineRangeStale: false,
    refreshCalendarDomains: null,
  };
}
