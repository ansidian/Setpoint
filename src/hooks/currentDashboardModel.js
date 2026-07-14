export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
};

export function mergeActiveSnapshotIntoCurrent(current, activeSnapshot) {
  if (!current || typeof current !== "object") return null;
  return {
    ...current,
    activeSnapshot,
    contentKey: null,
  };
}

// Content signature for a calendar event list. getCurrentDashboard() returns a
// freshly JSON-parsed `calendar` array on every poll/refetch, so its identity
// churns even when nothing changed. This signature lets a caller reuse the prior
// array reference when the contents are equivalent, killing the per-refetch
// effect/setEvents churn downstream (the event shape carries id/startMs/endMs).
export function calendarContentSignature(calendar) {
  if (!Array.isArray(calendar)) return calendar == null ? "null" : "invalid";
  let sig = `${calendar.length}`;
  for (const ev of calendar) {
    const id = ev?.id ?? ev?.iCalUID ?? ev?.htmlLink ?? ev?.openUrl ?? "";
    sig += `|${id}:${ev?.startMs ?? ""}:${ev?.endMs ?? ""}`;
  }
  return sig;
}

// Returns `prev` when its contents match `next` so the reference stays stable
// across refetches that did not actually change the calendar; otherwise `next`.
export function stabilizeCalendar(prev, next) {
  if (prev === next) return next;
  if (calendarContentSignature(prev) === calendarContentSignature(next)) return prev;
  return next;
}

// Mirrors calendarContentSignature for the deadlines domain: covers the fields
// that affect rendering (id/due_date/due_time/status/_completing) so a fresh
// `liveDeadlines.upcoming` array from an unchanged poll can reuse the prior
// reference — see currentDashboardModel usage note above.
export function deadlineContentSignature(upcoming) {
  if (!Array.isArray(upcoming)) return upcoming == null ? "null" : "invalid";
  let sig = `${upcoming.length}`;
  for (const item of upcoming) {
    const id = item?.id ?? item?.todoist_id ?? "";
    sig += `|${id}:${item?.due_date ?? ""}:${item?.due_time ?? ""}:${item?.status ?? ""}:${item?._completing ? 1 : 0}`;
  }
  return sig;
}

// Mirrors stabilizeCalendar for the deadlines domain (see stableCalendarRef in
// useCurrentDashboard.js for the ref-caching call-site pattern this pairs with).
export function stabilizeDeadlines(prev, next) {
  if (prev === next) return next;
  if (deadlineContentSignature(prev) === deadlineContentSignature(next)) return prev;
  return next;
}

export function hasActiveRefreshWork(current) {
  const currentSources = current?.providerHealth?.currentData?.sources || [];
  return currentSources.some((source) => source.state === "refreshing")
    || current?.providerHealth?.activeSnapshot?.state === "syncing"
    || !!current?.providerHealth?.activeSnapshot?.processing?.active
    || !!current?.activeSnapshot?.processing?.active;
}

export function currentToBriefing(current) {
  const deadlines = current?.deadlines || EMPTY_DEADLINES;
  return {
    weather: current?.weather || null,
    calendar: current?.calendar || [],
    deadlines,
    emails: { summary: "", accounts: [] },
  };
}

// Bulk live-data projection that depends only on `current` (the parsed payload)
// and the stable `refreshNow` callback. Deliberately excludes the volatile
// poll/loading flags so a caller can memoize this slice on `current` alone and
// keep a stable object reference across loading/refreshing toggles.
export function currentToLiveDataBulk(current, { refreshNow }) {
  return {
    liveEmails: [],
    liveCalendar: current?.calendar || null,
    liveDeadlines: current?.deadlines || EMPTY_DEADLINES,
    liveNextWeekCalendar: null,
    liveTomorrowCalendar: null,
    liveWeather: current?.weather || null,
    liveBills: current?.bills || [],
    recentTransactions: [],
    allSchedules: current?.allSchedules || [],
    payeeMap: current?.payeeMap || {},
    importantSenders: [],
    lastFetched: current?.fetchedAt || null,
    actualConfigured: !!current?.actualConfigured,
    actualBudgetUrl: current?.actualBudgetUrl || null,
    billsSyncHealth: current?.billsSyncHealth || null,
    snoozedEntries: [],
    resurfacedEntries: [],
    providerHealth: current?.providerHealth || null,
    systemStatus: current?.systemStatus || null,
    refreshNow,
  };
}

export function currentToLiveData(current, { refreshNow, isPolling }) {
  const bulk = currentToLiveDataBulk(current, { refreshNow });
  return {
    ...bulk,
    isPolling,
    billsLoading: bulk.actualConfigured && isPolling && !bulk.liveBills.length,
  };
}
