import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveSnapshot,
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../api";
import { isDemoMode } from "../demo/config.js";
import { invalidateActualMetadata } from "../lib/actualMetadata.js";
import { logTiming } from "../../shared/timing.js";
import {
  currentToBriefing,
  currentToLiveDataBulk,
  hasActiveRefreshWork,
  mergeActiveSnapshotIntoCurrent,
  stabilizeCalendar,
} from "./currentDashboardModel.js";
import {
  ACTIVE_SNAPSHOT_REFRESH_SCOPE,
  CURRENT_REFRESH_SCOPE,
  mergeRefreshScopes,
  refreshScopeForDashboardEvent,
} from "./dashboardEventRefreshModel.js";

const POST_CLICK_POLL_MS = 2_000;
const POST_CLICK_POLL_MAX_STEP_MS = 16_000;
const POST_CLICK_POLL_MAX_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function logEventRefetchTiming(eventContext, status) {
  if (!eventContext) return;
  try {
    logTiming({
      event: "dashboard-event-refetch",
      scope: eventContext.scope || "current",
      source: eventContext.source || "unknown",
      reason: eventContext.reason || "unknown",
      eventKey: eventContext.eventKey,
      ms: performance.now() - eventContext.startedAt,
      status,
    });
  } catch {
    // Diagnostics must never interfere with applying dashboard state.
  }
}

export default function useCurrentDashboard({ disabled = false, onDashboardEvent = null } = {}) {
  const [current, setCurrent] = useState(null);
  const [selectedBriefing, setSelectedBriefing] = useState(null);
  const [loading, setLoading] = useState(!disabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const mountedRef = useRef(true);
  const currentRequestInFlightRef = useRef(false);
  // Monotonic request id: every fetch captures one, and only the latest-issued
  // request is allowed to commit its response (older slow responses are dropped).
  const requestSeqRef = useRef(0);
  const inFlightOwnerRef = useRef(0);
  const queuedEventRefetchRef = useRef(null);
  const hiddenEventRefetchRef = useRef(false);
  const runEventRefetchRef = useRef(null);
  const onDashboardEventRef = useRef(onDashboardEvent);

  const applyCurrent = useCallback((data, seq) => {
    if (!mountedRef.current) return false;
    // Ignore a response whose request has been superseded by a newer one, so a
    // slow older fetch can't clobber fresher data (last-issued request wins).
    if (seq != null && seq !== requestSeqRef.current) return false;
    // Dedup identical poll payloads on the server content key so a poll that
    // returns the same snapshot doesn't re-derive liveData / re-render the tree.
    // Same end state, fewer redundant dispatches (P3-27). contentKey is a content
    // fingerprint that excludes the per-response wall clock, so it stays stable
    // across a poll/SSE burst over unchanged data — unlike fetchedAt, which the
    // server restamps every response (so keying on fetchedAt never deduped).
    // Fall back to fetchedAt when contentKey is absent (e.g. demo mode), and only
    // dedup when both sides carry a truthy key that matches — never skip a real change.
    setCurrent((prev) => {
      const prevKey = prev && Object.hasOwn(prev, "contentKey") ? prev.contentKey : prev?.fetchedAt;
      const nextKey = data && Object.hasOwn(data, "contentKey") ? data.contentKey : data?.fetchedAt;
      return prev && prevKey && nextKey && prevKey === nextKey ? prev : data;
    });
    setSelectedBriefing((prev) => (prev === null ? prev : null));
    setError((prev) => (prev === null ? prev : null));
    setLoaded((prev) => (prev === true ? prev : true));
    return true;
  }, []);

  const pollWhileRefreshActive = useCallback(async (initialData, seq) => {
    if (!initialData?.refresh || initialData.refresh.scheduled?.length === 0) return initialData;
    let latest = initialData;
    const startedAt = Date.now();
    let delay = POST_CLICK_POLL_MS;
    while (
      mountedRef.current
      && !document.hidden
      && (seq == null || seq === requestSeqRef.current)
      && hasActiveRefreshWork(latest)
      && Date.now() - startedAt < POST_CLICK_POLL_MAX_MS
    ) {
      await sleep(delay);
      delay = Math.min(delay * 2, POST_CLICK_POLL_MAX_STEP_MS);
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
      const queuedOptions = queuedEventRefetchRef.current;
      queuedEventRefetchRef.current = null;
      runEventRefetchRef.current?.(queuedOptions);
    }
  }, []);

  const runEventRefetch = useCallback(async ({
    allowHidden = false,
    eventContext = null,
    scope = CURRENT_REFRESH_SCOPE,
  } = {}) => {
    if (disabled) return null;
    if (document.hidden && !allowHidden) {
      hiddenEventRefetchRef.current = true;
      return null;
    }
    if (currentRequestInFlightRef.current) {
      const queued = queuedEventRefetchRef.current;
      const mergedScope = mergeRefreshScopes(queued?.scope, scope) || CURRENT_REFRESH_SCOPE;
      const keepQueuedContext = queued?.scope === mergedScope && scope !== mergedScope;
      queuedEventRefetchRef.current = {
        allowHidden: allowHidden || !!queued?.allowHidden,
        eventContext: keepQueuedContext ? queued.eventContext : eventContext,
        scope: mergedScope,
      };
      if (document.hidden) hiddenEventRefetchRef.current = true;
      return null;
    }
    currentRequestInFlightRef.current = true;
    const seq = ++requestSeqRef.current;
    inFlightOwnerRef.current = seq;
    let selectedScope = scope;
    try {
      let data;
      if (scope === ACTIVE_SNAPSHOT_REFRESH_SCOPE) {
        try {
          const activeSnapshot = await getActiveSnapshot();
          data = mergeActiveSnapshotIntoCurrent(currentRef.current, activeSnapshot);
          if (!data) throw new Error("Current dashboard envelope is unavailable");
        } catch {
          selectedScope = CURRENT_REFRESH_SCOPE;
          data = await getCurrentDashboard();
        }
      } else {
        data = await getCurrentDashboard();
      }
      const applied = applyCurrent(data, seq);
      const selectedEventContext = eventContext
        ? { ...eventContext, scope: selectedScope }
        : null;
      if (applied) logEventRefetchTiming(selectedEventContext, "ok");
      if (selectedScope === CURRENT_REFRESH_SCOPE && !document.hidden) {
        data = await pollWhileRefreshActive(data, seq);
      }
      return data;
    } catch {
      logEventRefetchTiming(
        eventContext ? { ...eventContext, scope: selectedScope } : null,
        "error",
      );
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
      const scope = refreshScopeForDashboardEvent(payload);
      runEventRefetch({
        allowHidden: true,
        scope,
        eventContext: {
          scope,
          source: payload?.source,
          reason: payload?.reason,
          eventKey: payload?.details?.eventKey,
          startedAt: performance.now(),
        },
      });
    };
    // Route an expired-session SSE failure to /login instead of letting the browser
    // reconnect-loop forever.
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
