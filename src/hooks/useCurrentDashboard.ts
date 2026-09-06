import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  getActiveSnapshot,
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} from "../api";
import { isDemoMode } from "../demo/config.ts";
import { invalidateActualMetadata } from "../lib/actualMetadata";
import { logTiming } from "../../shared/timing";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardEventInput,
  CurrentDashboardProviderHealth,
  CurrentDashboardResponse,
} from "../../shared/types/dashboard";
import type { ActiveSnapshotView } from "../../shared/types/snapshots";
import {
  currentToBriefing,
  currentToLiveDataBulk,
  hasActiveRefreshWork,
  mergeActiveSnapshotIntoCurrent,
  stabilizeCalendar,
} from "./currentDashboardModel";
import type {
  CurrentDashboardLiveData,
  DashboardBriefingProjection,
} from "./currentDashboardModel";
import {
  ACTIVE_SNAPSHOT_REFRESH_SCOPE,
  CURRENT_REFRESH_SCOPE,
  mergeRefreshScopes,
  refreshScopeForDashboardEvent,
} from "./dashboardEventRefreshModel";
import type { DashboardRefreshScope } from "./dashboardEventRefreshModel";
import { projectDashboardHealth } from "./currentDashboardHealthModel";
import type { DashboardClientSystemStatus } from "./currentDashboardHealthModel";

const POST_CLICK_POLL_MS = 2_000;
const POST_CLICK_POLL_MAX_STEP_MS = 16_000;
const POST_CLICK_POLL_MAX_MS = 45_000;

type DashboardLoadMode = "load" | "background" | "force";
type DashboardEventRefetchStatus = "ok" | "error";

interface DashboardEventRefetchContext {
  scope: DashboardRefreshScope;
  source?: unknown;
  reason?: unknown;
  eventKey?: unknown;
  startedAt: number;
}

interface DashboardEventRefetchOptions {
  allowHidden?: boolean;
  eventContext?: DashboardEventRefetchContext | null;
  scope?: DashboardRefreshScope;
}

type RunEventRefetch = (options?: DashboardEventRefetchOptions) => Promise<CurrentDashboardResponse | null>;

export interface CurrentDashboardHookOptions {
  disabled?: boolean;
  onDashboardEvent?: ((event: CurrentDashboardEventInput | null) => void) | null;
}

export interface DashboardSourceRetryState {
  source: CurrentDashboardCacheKey;
  state: "pending" | "success" | "error";
  message: string;
}

export interface CurrentDashboardHookResult {
  sourceRetry: DashboardSourceRetryState | null;
  retrySource: (source: CurrentDashboardCacheKey) => Promise<CurrentDashboardResponse | null>;
  current: CurrentDashboardResponse | null;
  providerHealth: CurrentDashboardProviderHealth | null;
  systemStatus: DashboardClientSystemStatus | null;
  briefingData: {
    briefing: DashboardBriefingProjection | null;
    setBriefing: Dispatch<SetStateAction<DashboardBriefingProjection | null>>;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    loaded: boolean;
    handleQuickRefresh: () => Promise<CurrentDashboardResponse | null>;
  };
  liveData: CurrentDashboardLiveData;
  activeSnapshot: {
    snapshot: ActiveSnapshotView | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<CurrentDashboardResponse | null>;
    sync: () => Promise<CurrentDashboardResponse | null>;
  };
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<CurrentDashboardResponse | null>;
  sync: () => Promise<CurrentDashboardResponse | null>;
  forceSync: () => Promise<CurrentDashboardResponse | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

function logEventRefetchTiming(
  eventContext: DashboardEventRefetchContext | null,
  status: DashboardEventRefetchStatus,
): void {
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return fallback;
}

function parseDashboardEvent(data: string): CurrentDashboardEventInput | null {
  try {
    const payload: unknown = JSON.parse(data || "{}");
    return payload && typeof payload === "object"
      ? payload as CurrentDashboardEventInput
      : null;
  } catch {
    return null;
  }
}

export default function useCurrentDashboard(
  { disabled = false, onDashboardEvent = null }: CurrentDashboardHookOptions = {},
): CurrentDashboardHookResult {
  const [current, setCurrent] = useState<CurrentDashboardResponse | null>(null);
  const [selectedBriefing, setSelectedBriefing] = useState<DashboardBriefingProjection | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [refreshing, setRefreshing] = useState(false);
  const [sourceRetry, setSourceRetry] = useState<DashboardSourceRetryState | null>(null);
  const sourceRetryOwnerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [healthReadFailed, setHealthReadFailed] = useState(false);
  const [offline, setOffline] = useState(() => !isDemoMode() && navigator.onLine === false);
  const [liveUpdatesDisconnected, setLiveUpdatesDisconnected] = useState(false);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<string | null>(null);
  const [healthNow, setHealthNow] = useState(Date.now);
  const currentRef = useRef(current);
  currentRef.current = current;
  const mountedRef = useRef(true);
  const currentRequestInFlightRef = useRef(false);
  // Monotonic request id: every fetch captures one, and only the latest-issued
  // request is allowed to commit its response (older slow responses are dropped).
  const requestSeqRef = useRef(0);
  const inFlightOwnerRef = useRef(0);
  const queuedEventRefetchRef = useRef<DashboardEventRefetchOptions | null>(null);
  const hiddenEventRefetchRef = useRef(false);
  const runEventRefetchRef = useRef<RunEventRefetch | null>(null);
  const onDashboardEventRef = useRef(onDashboardEvent);

  const applyCurrent = useCallback((data: CurrentDashboardResponse, seq: number | null, checkedHealth = true): boolean => {
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
      const prevKey = prev && Object.prototype.hasOwnProperty.call(prev, "contentKey") ? prev.contentKey : prev?.fetchedAt;
      const nextKey = Object.prototype.hasOwnProperty.call(data, "contentKey") ? data.contentKey : data.fetchedAt;
      return prev && prevKey && nextKey && prevKey === nextKey ? prev : data;
    });
    setSelectedBriefing((prev) => (prev === null ? prev : null));
    if (checkedHealth) {
      setSourceRetry((previous) => previous?.state === "pending" ? previous : null);
      setError(null);
      setHealthReadFailed(false);
      setLastHealthCheckAt(new Date().toISOString());
      setHealthNow(Date.now());
    }
    setLoaded((prev) => (prev === true ? prev : true));
    return true;
  }, []);

  const pollWhileRefreshActive = useCallback(async (
    initialData: CurrentDashboardResponse,
    seq: number | null,
  ): Promise<CurrentDashboardResponse> => {
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

  const completeCurrentRequest = useCallback((seq: number | null): void => {
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

  const runEventRefetch: RunEventRefetch = useCallback(async ({
    allowHidden = false,
    eventContext = null,
    scope = CURRENT_REFRESH_SCOPE,
  } = {}) => {
    if (disabled) return null;
    // The awaited retry returns the full envelope. An SSE read here would
    // supersede that result and could schedule unrelated provider work.
    if (sourceRetryOwnerRef.current != null) return null;
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
      const applied = applyCurrent(data, seq, selectedScope === CURRENT_REFRESH_SCOPE);
      const selectedEventContext = eventContext
        ? { ...eventContext, scope: selectedScope }
        : null;
      if (applied) logEventRefetchTiming(selectedEventContext, "ok");
      if (selectedScope === CURRENT_REFRESH_SCOPE && !document.hidden) {
        data = await pollWhileRefreshActive(data, seq);
      }
      return data;
    } catch {
      if (mountedRef.current && seq === requestSeqRef.current) setHealthReadFailed(true);
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

  const loadCurrent = useCallback(async (
    { mode = "load" }: { mode?: DashboardLoadMode } = {},
  ): Promise<CurrentDashboardResponse | null> => {
    if (disabled || sourceRetryOwnerRef.current != null) return null;
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
    } catch (err: unknown) {
      // Don't let a stale request's error clobber a newer request's success.
      if (mountedRef.current && seq === requestSeqRef.current) {
        setError(errorMessage(err, "Failed to load current dashboard data."));
        setHealthReadFailed(true);
        setLoaded(false);
      }
      return null;
    } finally {
      if (mountedRef.current && inFlightOwnerRef.current === seq) {
        setLoading(false);
        setRefreshing(false);
        completeCurrentRequest(seq);
      } else if (inFlightOwnerRef.current === seq) {
        currentRequestInFlightRef.current = false;
      }
    }
  }, [applyCurrent, completeCurrentRequest, disabled, pollWhileRefreshActive]);

  const retrySource = useCallback(async (source: CurrentDashboardCacheKey) => {
    if (disabled || sourceRetryOwnerRef.current != null) return null;
    const sourceKey = currentRef.current?.systemStatus?.sources.find((item) => item.retrySource === source)?.key;
    const seq = ++requestSeqRef.current;
    sourceRetryOwnerRef.current = seq;
    inFlightOwnerRef.current = seq;
    currentRequestInFlightRef.current = true;
    setSourceRetry({ source, state: "pending", message: "Checking for updates…" });
    try {
      const data = await requestCurrentDashboardRefresh(source);
      if (!applyCurrent(data, seq)) return null;
      const result = data.systemStatus.sources.find((item) => item.retrySource === source || (sourceKey && item.key === sourceKey));
      setSourceRetry({
        source,
        state: result?.state === "current" ? "success" : "error",
        message: result?.state === "current" ? `${result.label} is up to date.`
          : result?.state === "needs_reauth" ? `Reconnect ${result.label} to try again.`
            : `${result?.label || "This source"} still needs attention.`,
      });
      return data;
    } catch {
      if (mountedRef.current && seq === requestSeqRef.current) {
        setSourceRetry({ source, state: "error", message: "Could not check for updates. Try again." });
      }
      return null;
    } finally {
      if (sourceRetryOwnerRef.current === seq) sourceRetryOwnerRef.current = null;
      if (inFlightOwnerRef.current === seq) {
        currentRequestInFlightRef.current = false;
        // The returned envelope covers coalesced changes; do not flush a GET
        // just because a targeted retry ended (GET can refresh other sources).
        queuedEventRefetchRef.current = null;
        if (mountedRef.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }, [applyCurrent, disabled]);

  const refreshNow = useCallback(() => loadCurrent({ mode: "load" }), [loadCurrent]);
  const sync = useCallback(() => loadCurrent({ mode: "background" }), [loadCurrent]);
  const forceSync = useCallback(() => loadCurrent({ mode: "force" }), [loadCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    if (disabled) {
      requestSeqRef.current += 1;
      sourceRetryOwnerRef.current = null;
      setSourceRetry(null);
      setCurrent(null);
      setSelectedBriefing(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      setLoaded(false);
      setHealthReadFailed(false);
      setLastHealthCheckAt(null);
      setLiveUpdatesDisconnected(false);
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
    let interrupted = false;
    const handleOpen = () => {
      setLiveUpdatesDisconnected(false);
      if (interrupted) {
        setHealthReadFailed(true);
        interrupted = false;
        void runEventRefetch();
      }
    };
    const handleChanged = (event: Event) => {
      const payload = parseDashboardEvent(event instanceof MessageEvent ? String(event.data || "") : "");
      if (payload?.source === "bills") invalidateActualMetadata();
      if (payload?.reason === "financial_event_changed") window.dispatchEvent(new CustomEvent("ea-financial-event-changed"));
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
      interrupted = true;
      setLiveUpdatesDisconnected(true);
      // A 401 (or any rejected handshake) closes the stream terminally — readyState stays CLOSED
      // and the browser will NOT auto-reconnect. Transient network blips set readyState back to
      // CONNECTING, which we ignore so a single flicker does not bounce the user to login.
      const closedState = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;
      if (source.readyState === closedState) {
        source.close();
        // Mirror apiFetch's 401 handling (src/api.ts) so recovery is immediate and not
        // dependent on an unrelated poll firing its own redirect.
        window.location.href = "/login";
      }
    };
    source.addEventListener("dashboard-current-changed", handleChanged);
    source.addEventListener("open", handleOpen);
    source.onerror = handleError;
    return () => {
      source.removeEventListener?.("dashboard-current-changed", handleChanged);
      source.removeEventListener?.("open", handleOpen);
      source.onerror = null;
      source.close();
    };
  }, [disabled, runEventRefetch]);

  useEffect(() => {
    if (disabled || isDemoMode()) return undefined;
    const tick = () => { if (!document.hidden) setHealthNow(Date.now()); };
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      // Remain explicit about unverified health until the full read succeeds.
      setHealthReadFailed(true);
      void runEventRefetch();
    };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", tick);
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
  const stableCalendarRef = useRef<CurrentDashboardResponse["calendar"] | null>(null);
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
  const systemStatus = useMemo(() => projectDashboardHealth(current?.systemStatus, {
    readFailed: healthReadFailed,
    offline,
    liveUpdatesDisconnected,
    lastCheckedAt: lastHealthCheckAt,
    now: healthNow,
  }), [current?.systemStatus, healthReadFailed, offline, liveUpdatesDisconnected, lastHealthCheckAt, healthNow]);
  const liveData = useMemo(
    () => ({
      ...liveDataBulk,
      systemStatus,
      isPolling,
      billsLoading: liveDataBulk.actualConfigured && isPolling && !liveDataBulk.liveBills.length,
    }),
    [liveDataBulk, isPolling, systemStatus],
  );

  const activeSnapshot = useMemo(() => ({
    snapshot: current?.activeSnapshot || null,
    loading,
    error,
    refresh: refreshNow,
    sync,
  }), [current?.activeSnapshot, error, loading, refreshNow, sync]);

  return {
    sourceRetry,
    retrySource,
    current,
    providerHealth: current?.providerHealth || null,
    systemStatus,
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
