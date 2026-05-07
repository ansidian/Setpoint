export const EMPTY_DEADLINES = {
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
};

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
    ctm: deadlines.ctm || EMPTY_DEADLINES.ctm,
    todoist: deadlines.todoist || EMPTY_DEADLINES.todoist,
    emails: { summary: "", accounts: [] },
  };
}

export function currentToLiveData(current, { refreshNow, isPolling }) {
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
    briefingReadStatus: {},
    lastFetched: current?.fetchedAt || null,
    isPolling,
    billsLoading: !!current?.actualConfigured && isPolling && !(current?.bills || []).length,
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
