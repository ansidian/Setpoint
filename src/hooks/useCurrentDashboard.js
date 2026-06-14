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
  currentToLiveDataBulk,
  hasActiveRefreshWork,
  stabilizeCalendar,
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
  // Monotonic request id: every fetch captures one, and only the latest-issued
  // request is allowed to commit its response (older slow responses are dropped).
  const requestSeqRef = useRef(0);
  const inFlightOwnerRef = useRef(0);
  const queuedEventRefetchRef = useRef(false);
  const hiddenEventRefetchRef = useRef(false);
  const runEventRefetchRef = useRef(null);
  const onDashboardEventRef = useRef(onDashboardEvent);

  const applyCurrent = useCallback((data, seq) => {
    if (!mountedRef.current) return data;
    // Ignore a response whose request has been superseded by a newer one, so a
    // slow older fetch can't clobber fresher data (last-issued request wins).
    if (seq != null && seq !== requestSeqRef.current) return data;
    // Dedup identical poll payloads on the server freshness key so a poll that
    // returns the same snapshot doesn't re-derive liveData / re-render the tree.
    // Same end state, fewer redundant dispatches (P3-27). Only dedup when both
    // sides carry a truthy fetchedAt and they match — never skip a real change.
    setCurrent((prev) => (
      prev && prev.fetchedAt && data?.fetchedAt && prev.fetchedAt === data.fetchedAt ? prev : data
    ));
    setSelectedBriefing((prev) => (prev === null ? prev : null));
    setError((prev) => (prev === null ? prev : null));
    setLoaded((prev) => (prev === true ? prev : true));
    return data;
  }, []);

  const pollWhileRefreshActive = useCallback(async (initialData, seq) => {
    if (!initialData?.refresh || initialData.refresh.scheduled?.length === 0) return initialData;
    let latest = initialData;
    const startedAt = Date.now();
    while (
      mountedRef.current
      && !document.hidden
      && (seq == null || seq === requestSeqRef.current)
      && hasActiveRefreshWork(latest)
      && Date.now() - startedAt < POST_CLICK_POLL_MAX_MS
    ) {
      await sleep(POST_CLICK_POLL_MS);
      if (!mountedRef.current || document.hidden || (seq != null && seq !== requestSeqRef.current)) break;
      latest = await getCurrentDashboard();
      applyCurrent(latest, seq);
    }
    return latest;
  }, [applyCurrent]);

  const completeCurrentRequest = useCallback((seq) => {
    // Only the request that currently owns the in-flight flag may clear it, so a
    // faster older request can't release the flag out from under a newer one.
    if (seq != null && inFlightOwnerRef.current !== seq) return;
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
    const seq = ++requestSeqRef.current;
    inFlightOwnerRef.current = seq;
    try {
      let data = await getCurrentDashboard();
      applyCurrent(data, seq);
      if (!document.hidden) {
        data = await pollWhileRefreshActive(data, seq);
      }
      return data;
    } catch {
      if (document.hidden) hiddenEventRefetchRef.current = true;
      return null;
    } finally {
      if (mountedRef.current) {
        completeCurrentRequest(seq);
      } else if (inFlightOwnerRef.current === seq) {
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
    const seq = ++requestSeqRef.current;
    inFlightOwnerRef.current = seq;
    try {
      let data = await fetcher();
      applyCurrent(data, seq);
      if (mode === "background") {
        data = await pollWhileRefreshActive(data, seq);
      }
      return data;
    } catch (err) {
      // Don't let a stale request's error clobber a newer request's success.
      if (mountedRef.current && seq === requestSeqRef.current) {
        setError(err.message || "Failed to load current dashboard data.");
        setLoaded(false);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        completeCurrentRequest(seq);
      } else if (inFlightOwnerRef.current === seq) {
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
    // MERGE-NOTE[P3-2] (P3 worktree): route an expired-session SSE failure to /login instead of
    // letting the browser reconnect-loop forever. Shares this file with a P2 fix on another
    // worktree. On conflict: keep BOTH unless they touch the same lines. Remove note after merge.
    const handleError = () => {
      // A 401 (or any rejected handshake) closes the stream terminally — readyState stays CLOSED
      // and the browser will NOT auto-reconnect. Transient network blips set readyState back to
      // CONNECTING, which we ignore so a single flicker does not bounce the user to login.
      const closedState = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;
      if (source.readyState === closedState) {
        source.close();
        // Mirror apiFetch's 401 handling (src/api.js) so recovery is immediate and not
        // dependent on an unrelated poll firing its own redirect.
        window.location.href = "/login";
      }
    };
    source.addEventListener("dashboard-current-changed", handleChanged);
    source.onerror = handleError;
    return () => {
      source.removeEventListener?.("dashboard-current-changed", handleChanged);
      source.onerror = null;
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

  // Stabilize the calendar array's identity across refetches that did not change
  // its contents — getCurrentDashboard re-parses `current.calendar` every poll,
  // so without this the DashboardBody range effect + every liveCalendar-keyed
  // effect re-fires on every tick even when the calendar is unchanged.
  const stableCalendarRef = useRef(null);
  const stableCalendar = useMemo(() => {
    const next = stabilizeCalendar(stableCalendarRef.current, current?.calendar || null);
    stableCalendarRef.current = next;
    return next;
  }, [current?.calendar]);

  // Memoize the bulk slice on `current` (+ stable refreshNow) only, so the nested
  // data arrays (liveCalendar/liveDeadlines/liveBills/…) keep stable references
  // across loading/refreshing toggles. The volatile poll flags are layered on
  // top separately — only liveData's top-level identity changes when they flip,
  // not the contained arrays, so memoized children keyed on those arrays bail out.
  const liveDataBulk = useMemo(
    () => ({
      ...currentToLiveDataBulk(current, { refreshNow }),
      liveCalendar: stableCalendar,
    }),
    [current, refreshNow, stableCalendar],
  );
  const isPolling = loading || refreshing;
  const liveData = useMemo(
    () => ({
      ...liveDataBulk,
      isPolling,
      billsLoading: liveDataBulk.actualConfigured && isPolling && !liveDataBulk.liveBills.length,
    }),
    [liveDataBulk, isPolling],
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
