import { useState, useEffect, useRef, useCallback } from "react";
import { getLiveData } from "../api";

const LIVE_POLL_INTERVAL_MS = 2 * 60 * 1000;
const LIVE_FOCUS_COOLDOWN_MS = 15 * 1000;

export default function useLiveData({ disabled = false } = {}) {
  const [liveEmails, setLiveEmails] = useState([]);
  const [liveCalendar, setLiveCalendar] = useState(null);
  const [liveNextWeekCalendar, setLiveNextWeekCalendar] = useState(null);
  const [liveTomorrowCalendar, setLiveTomorrowCalendar] = useState(null);
  const [liveWeather, setLiveWeather] = useState(null);
  const [liveBills, setLiveBills] = useState([]);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [allSchedules, setAllSchedules] = useState([]);
  const [payeeMap, setPayeeMap] = useState({});
  const [importantSenders, setImportantSenders] = useState([]);
  const [briefingGeneratedAt, setBriefingGeneratedAt] = useState(null);
  const [briefingReadStatus, setBriefingReadStatus] = useState({});
  const [lastFetched, setLastFetched] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [billsLoading, setBillsLoading] = useState(true);
  const [actualConfigured, setActualConfigured] = useState(true);
  const [actualBudgetUrl, setActualBudgetUrl] = useState(null);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [pinnedSnapshots, setPinnedSnapshots] = useState([]);
  const [snoozedEntries, setSnoozedEntries] = useState([]);
  const [resurfacedEntries, setResurfacedEntries] = useState([]);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const lastFetchStartedAtRef = useRef(0);

  const fetchLive = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    lastFetchStartedAtRef.current = Date.now();
    setIsPolling(true);
    try {
      const data = await getLiveData();
      if (!mountedRef.current) return;
      setLiveEmails(data.emails || []);
      setLiveCalendar(data.calendar || null);
      setLiveNextWeekCalendar(data.nextWeekCalendar || null);
      setLiveTomorrowCalendar(data.tomorrowCalendar || null);
      setLiveWeather(data.weather || null);
      setLiveBills(data.bills || []);
      setRecentTransactions(data.recentTransactions || []);
      setAllSchedules(data.allSchedules || []);
      setPayeeMap(data.payeeMap || {});
      setImportantSenders(data.importantSenders || []);
      setBriefingGeneratedAt(data.briefingGeneratedAt || null);
      setBriefingReadStatus(data.briefingReadStatus || {});
      setLastFetched(data.fetchedAt || new Date().toISOString());
      setActualConfigured(data.actualConfigured || false);
      setActualBudgetUrl(data.actualBudgetUrl || null);
      setPinnedIds(data.pinnedIds || []);
      setPinnedSnapshots(data.pinnedSnapshots || []);
      setSnoozedEntries(data.snoozedEntries || []);
      setResurfacedEntries(data.resurfacedEntries || []);
      setBillsLoading(false);
    } catch (err) {
      console.error("[Live] Fetch failed:", err.message);
      setBillsLoading(false);
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) setIsPolling(false);
    }
  }, []);

  const refreshNow = fetchLive;

  useEffect(() => {
    mountedRef.current = true;
    if (disabled) {
      setLiveBills([]);
      setRecentTransactions([]);
      setBillsLoading(true);
      setActualConfigured(true);
      return;
    }
    fetchLive();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchLive, disabled]);

  useEffect(() => {
    if (disabled) return;

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      fetchLive();
    };

    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchStartedAtRef.current < LIVE_FOCUS_COOLDOWN_MS) return;
      fetchLive();
    };

    const intervalId = setInterval(refreshIfVisible, LIVE_POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [fetchLive, disabled]);

  return {
    liveEmails,
    liveCalendar,
    liveNextWeekCalendar,
    liveTomorrowCalendar,
    liveWeather,
    liveBills,
    recentTransactions,
    allSchedules,
    payeeMap,
    importantSenders,
    briefingGeneratedAt,
    briefingReadStatus,
    lastFetched,
    isPolling,
    billsLoading,
    actualConfigured,
    actualBudgetUrl,
    pinnedIds,
    pinnedSnapshots,
    snoozedEntries,
    resurfacedEntries,
    refreshNow,
  };
}
