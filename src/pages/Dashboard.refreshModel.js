export function shouldTriggerSyncHotkey(event = {}, { refreshing = false, syncing = false } = {}) {
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
} = {}) {
  if (currentSyncing) {
    return { shouldRun: false };
  }

  const explicit = trigger === "explicit";
  const eventsRange = calendarWorkspace?.eventsRange;
  const shouldRefreshVisibleEvents = (
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
      ? { start: eventsRange.start, end: eventsRange.end }
      : null,
    markCalendarEventsStale: explicit && !shouldRefreshVisibleEvents,
    markDeadlineRangeStale: explicit,
    markBillRangeStale: explicit,
    markBillsRefreshRequested: explicit,
    refreshCalendarDomains: explicit ? { force: true, includeBills: true } : null,
  };
}

export function resolveDashboardCurrentEventPlan(event = {}) {
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
