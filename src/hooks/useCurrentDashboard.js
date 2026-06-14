import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../api";
import { isDemoMode } from "../demo/config.js";
import { invalidateActualMetadata } from "../lib/actualMetadata.js";
import {
  currentToBriefing,
  currentToLiveData,
  hasActiveRefreshWork,
} from "./currentDashboardModel.js";

const POST_CLICK_POLL_MS = 2_000;
const POST_CLICK_POLL_MAX_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export default function useCurrentDashboard({ disabled = false, onDashboardEvent = null } = {}) {
  const [current, setCurrent] = useState(null);
  const [selectedBriefing, setSelectedBriefing] = useState(null);
  const [loading, setLoading] = useState(!disabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);
  const currentRequestInFlightRef = useRef(false);
  const queuedEventRefetchRef = useRef(false);
  const hiddenEventRefetchRef = useRef(false);
  const runEventRefetchRef = useRef(null);
  const onDashboardEventRef = useRef(onDashboardEvent);

  const applyCurrent = useCallback((data) => {
    if (!mountedRef.current) return data;
    setCurrent(data);
    setSelectedBriefing(null);
    setError(null);
    setLoaded(true);
    return data;
  }, []);

  const pollWhileRefreshActive = useCallback(async (initialData) => {
    if (!initialData?.refresh || initialData.refresh.scheduled?.length === 0) return initialData;
    let latest = initialData;
    const startedAt = Date.now();
    while (
      mountedRef.current
      && !document.hidden
      && hasActiveRefreshWork(latest)
      && Date.now() - startedAt < POST_CLICK_POLL_MAX_MS
    ) {
      await sleep(POST_CLICK_POLL_MS);
      if (!mountedRef.current || document.hidden) break;
      latest = await getCurrentDashboard();
      applyCurrent(latest);
    }
    return latest;
  }, [applyCurrent]);

  const completeCurrentRequest = useCallback(() => {
    currentRequestInFlightRef.current = false;
    if (queuedEventRefetchRef.current && !document.hidden) {
      queuedEventRefetchRef.current = false;
      runEventRefetchRef.current?.();
    }
  }, []);

  const runEventRefetch = useCallback(async ({ allowHidden = false } = {}) => {
    if (disabled) return null;
    if (document.hidden && !allowHidden) {
      hiddenEventRefetchRef.current = true;
      return null;
    }
    if (currentRequestInFlightRef.current) {
      queuedEventRefetchRef.current = true;
      if (document.hidden) hiddenEventRefetchRef.current = true;
      return null;
    }
    currentRequestInFlightRef.current = true;
    try {
      let data = await getCurrentDashboard();
      applyCurrent(data);
      if (!document.hidden) {
        data = await pollWhileRefreshActive(data);
      }
      return data;
    } catch {
      if (document.hidden) hiddenEventRefetchRef.current = true;
      return null;
    } finally {
      if (mountedRef.current) {
        completeCurrentRequest();
      } else {
        currentRequestInFlightRef.current = false;
      }
    }
  }, [applyCurrent, completeCurrentRequest, disabled, pollWhileRefreshActive]);

  useEffect(() => {
    runEventRefetchRef.current = runEventRefetch;
  }, [runEventRefetch]);

  useEffect(() => {
    onDashboardEventRef.current = onDashboardEvent;
  }, [onDashboardEvent]);

  const loadCurrent = useCallback(async ({ mode = "load" } = {}) => {
    if (disabled) return null;
    const fetcher = mode === "force"
      ? syncCurrentDashboard
      : mode === "background"
        ? requestCurrentDashboardRefresh
        : getCurrentDashboard;
    if (mode !== "load") setRefreshing(true);
    else setLoading(true);
    currentRequestInFlightRef.current = true;
    try {
      let data = await fetcher();
      applyCurrent(data);
      if (mode === "background") {
        data = await pollWhileRefreshActive(data);
      }
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
        completeCurrentRequest();
      } else {
        currentRequestInFlightRef.current = false;
      }
    }
  }, [applyCurrent, completeCurrentRequest, disabled, pollWhileRefreshActive]);

  const refreshNow = useCallback(() => loadCurrent({ mode: "load" }), [loadCurrent]);
  const sync = useCallback(() => loadCurrent({ mode: "background" }), [loadCurrent]);
  const forceSync = useCallback(() => loadCurrent({ mode: "force" }), [loadCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    if (disabled) {
      setCurrent(null);
      setSelectedBriefing(null);
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

  useEffect(() => {
    if (disabled || isDemoMode() || typeof EventSource === "undefined") return undefined;
    const source = new EventSource("/api/dashboard/current/events");
    const handleChanged = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event?.data || "{}");
      } catch {
        payload = null;
      }
      if (payload?.source === "bills") invalidateActualMetadata();
      if (typeof onDashboardEventRef.current === "function") {
        onDashboardEventRef.current(payload);
      }
      runEventRefetch({ allowHidden: true });
    };
    source.addEventListener("dashboard-current-changed", handleChanged);
    return () => {
      source.removeEventListener?.("dashboard-current-changed", handleChanged);
      source.close();
    };
  }, [disabled, runEventRefetch]);

  useEffect(() => {
    if (disabled) return undefined;
    const handleVisibilityChange = () => {
      if (document.hidden || !hiddenEventRefetchRef.current) return;
      hiddenEventRefetchRef.current = false;
      runEventRefetch();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [disabled, runEventRefetch]);

  const currentBriefing = useMemo(() => currentToBriefing(current), [current]);
  const briefing = selectedBriefing || (current ? currentBriefing : null);

  const briefingData = useMemo(() => ({
    briefing,
    setBriefing: setSelectedBriefing,
    loading,
    refreshing,
    error,
    loaded,
    handleQuickRefresh: refreshNow,
  }), [briefing, error, loaded, loading, refreshNow, refreshing]);

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
