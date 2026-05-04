import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../api";

const EMPTY_DEADLINES = {
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
};

function currentToBriefing(current) {
  const deadlines = current?.deadlines || EMPTY_DEADLINES;
  return {
    generatedAt: "",
    dataUpdatedAt: current?.fetchedAt || null,
    aiGeneratedAt: null,
    skippedAI: false,
    nonAiGenerationCount: 0,
    weather: current?.weather || null,
    aiInsights: [],
    calendar: current?.calendar || [],
    ctm: deadlines.ctm || EMPTY_DEADLINES.ctm,
    todoist: deadlines.todoist || EMPTY_DEADLINES.todoist,
    model: null,
    emails: { summary: "", accounts: [] },
  };
}

function currentToLiveData(current, { refreshNow, isPolling }) {
  return {
    liveEmails: [],
    liveCalendar: current?.calendar || null,
    liveNextWeekCalendar: null,
    liveTomorrowCalendar: null,
    liveWeather: current?.weather || null,
    liveBills: current?.bills || [],
    recentTransactions: [],
    allSchedules: current?.allSchedules || [],
    payeeMap: current?.payeeMap || {},
    importantSenders: [],
    briefingGeneratedAt: null,
    briefingReadStatus: {},
    lastFetched: current?.fetchedAt || null,
    isPolling,
    billsLoading: !!current?.actualConfigured && isPolling && !(current?.bills || []).length,
    actualConfigured: !!current?.actualConfigured,
    actualBudgetUrl: current?.actualBudgetUrl || null,
    snoozedEntries: [],
    resurfacedEntries: [],
    providerHealth: current?.providerHealth || null,
    systemStatus: current?.systemStatus || null,
    refreshNow,
  };
}

export default function useCurrentDashboard({ disabled = false } = {}) {
  const [current, setCurrent] = useState(null);
  const [selectedBriefing, setSelectedBriefing] = useState(null);
  const [viewingPast, setViewingPast] = useState(null);
  const [loading, setLoading] = useState(!disabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  const loadCurrent = useCallback(async ({ mode = "load" } = {}) => {
    if (disabled) return null;
    const fetcher = mode === "force"
      ? syncCurrentDashboard
      : mode === "background"
        ? requestCurrentDashboardRefresh
        : getCurrentDashboard;
    if (mode !== "load") setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetcher();
      if (!mountedRef.current) return data;
      setCurrent(data);
      setSelectedBriefing(null);
      setViewingPast(null);
      setError(null);
      setLoaded(true);
      return data;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || "Failed to load current dashboard data.");
        setLoaded(false);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [disabled]);

  const refreshNow = useCallback(() => loadCurrent({ mode: "load" }), [loadCurrent]);
  const sync = useCallback(() => loadCurrent({ mode: "background" }), [loadCurrent]);
  const forceSync = useCallback(() => loadCurrent({ mode: "force" }), [loadCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    if (disabled) {
      setCurrent(null);
      setSelectedBriefing(null);
      setViewingPast(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      setLoaded(false);
      return undefined;
    }
    loadCurrent();
    return () => {
      mountedRef.current = false;
    };
  }, [disabled, loadCurrent]);

  const currentBriefing = useMemo(() => currentToBriefing(current), [current]);
  const briefing = selectedBriefing || (current ? currentBriefing : null);

  const briefingData = useMemo(() => ({
    briefing,
    setBriefing: setSelectedBriefing,
    loading,
    refreshing,
    generating: false,
    error,
    loaded,
    modelLabel: "AI",
    genProgress: null,
    viewingPast,
    latestId: null,
    schedules: [],
    setSchedules: () => {},
    renderConfigured: false,
    lastQuickRefreshAt: null,
    handleQuickRefresh: refreshNow,
    handleFullGeneration: () => {},
    selectHistory: (briefingData, meta) => {
      setSelectedBriefing(briefingData);
      setViewingPast(meta);
    },
    backToLatest: () => {
      setSelectedBriefing(null);
      setViewingPast(null);
    },
    navigateToEmail: ({ briefing: navBriefing, briefingId, generated_at, emailId, accountName }) => {
      setSelectedBriefing(navBriefing);
      setViewingPast({ id: briefingId, generated_at });
      return { navBriefing, emailId, accountName };
    },
  }), [briefing, error, loaded, loading, refreshNow, refreshing, viewingPast]);

  const liveData = useMemo(
    () => currentToLiveData(current, { refreshNow, isPolling: loading || refreshing }),
    [current, loading, refreshNow, refreshing],
  );

  const activeSnapshot = useMemo(() => ({
    snapshot: current?.activeSnapshot || null,
    loading,
    error,
    refresh: refreshNow,
    sync,
  }), [current?.activeSnapshot, error, loading, refreshNow, sync]);

  return {
    current,
    providerHealth: current?.providerHealth || null,
    systemStatus: current?.systemStatus || null,
    briefingData,
    liveData,
    activeSnapshot,
    loading,
    refreshing,
    error,
    refresh: refreshNow,
    sync,
    forceSync,
  };
}
