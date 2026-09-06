import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getCalendarBillsRange, getCalendarDeadlines, getCalendarDeadlinesRange } from "../api";
import LoadingSkeleton from "../components/layout/LoadingSkeleton";
import ErrorState from "../components/layout/ErrorState";
import { Sun } from "lucide-react";
import { Link } from "react-router";
import { DashboardProvider } from "../context/DashboardContext";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import useCurrentDashboard from "../hooks/useCurrentDashboard";
import useAutoRefresh from "../hooks/useAutoRefresh";
import useNotifications from "../hooks/useNotifications";
import useTriageNotificationSounds from "../hooks/useTriageNotificationSounds";
import useStaleDomainCache from "../hooks/calendar/useStaleDomainCache";
import useCalendarRange from "../hooks/calendar/useCalendarRange";
import { DashboardShell, DashboardBody } from "../components/dashboard/DashboardShell";
import { makeCalendarBillsData } from "../components/dashboard/calendarBillsData";
import EmptyStateSplash from "../components/shared/EmptyStateSplash";
import { resolveDashboardBriefingState } from "./Dashboard.bootState";
import {
  resolveDashboardCurrentEventPlan,
  resolveDashboardRefreshPlan,
  shouldTriggerSyncHotkey,
} from "./Dashboard.refreshModel";
import type { CurrentDashboardEventInput } from "../../shared/types/dashboard";
import type { DashboardDeadlineRoot } from "../context/dashboardTaskProjection";
import type { DashboardCalendarBillsData } from "../components/dashboard/calendarBillsData";
import type { DashboardCalendarWorkspaceState } from "../components/dashboard/useCalendarWorkspaceState";
import type { DashboardCalendarModalMountProps } from "../components/dashboard/DashboardCalendarModalMount";

interface DashboardDomainLoadOptions {
  force?: boolean;
  refreshLive?: boolean;
}
interface DashboardDomainCache<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
  load: (options?: DashboardDomainLoadOptions) => void;
  update: (updater: T | ((current: T | null) => T)) => void;
  range: { markStale?: () => void };
}
interface DashboardDomainCacheOptions<T> {
  fetchDomain: (options?: DashboardDomainLoadOptions) => T | Promise<T>;
  initialData?: T | null;
  seed?: T | null;
  fetchRange?: unknown;
  emptyData?: null;
  cacheMode?: string;
  prefetchMonthRadius?: number;
}
const useDashboardDomainCache = useStaleDomainCache as unknown as <T>(
  options: DashboardDomainCacheOptions<T>,
) => DashboardDomainCache<T>;

const SYNC_WATCHDOG_MS = 45_000;

function withSyncWatchdog<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, SYNC_WATCHDOG_MS)),
  ]);
}

export default function Dashboard() {
  const triageNotificationSounds = useTriageNotificationSounds();
  const dashboardEventHandlerRef = useRef<((event: CurrentDashboardEventInput | null) => void) | null>(null);
  const currentDashboard = useCurrentDashboard({
    onDashboardEvent: (event) => dashboardEventHandlerRef.current?.(event),
  });
  const sourceRetryPending = currentDashboard.sourceRetry?.state === "pending";
  const liveData = currentDashboard.liveData;
  const activeSnapshot = currentDashboard.activeSnapshot;
  const calendarRange = useCalendarRange();
  const calendarBillsRefreshRequestedRef = useRef(false);
  const refreshLiveDataNow = liveData.refreshNow;
  const currentDomainSources = liveData.providerHealth?.currentData?.sources || [];
  const billsCurrentRefreshing = currentDomainSources.some((source) =>
    source.key === "bills_current" && source.state === "refreshing",
  );
  const domainRefreshing = currentDomainSources.some((source) =>
    (source.key === "bills_current" || source.key === "deadlines_current")
      && source.state === "refreshing",
  );
  const deadlinesCache = useDashboardDomainCache<DashboardDeadlineRoot>({
    fetchDomain: async () => await getCalendarDeadlines() as DashboardDeadlineRoot,
    seed: Array.isArray(liveData.liveDeadlines?.upcoming) ? liveData.liveDeadlines as DashboardDeadlineRoot : null,
    fetchRange: getCalendarDeadlinesRange,
    emptyData: null,
    cacheMode: "month",
    prefetchMonthRadius: 1,
  });
  const billsCache = useDashboardDomainCache<DashboardCalendarBillsData>({
    fetchDomain: (opts?: DashboardDomainLoadOptions) => {
      if (opts?.refreshLive) {
        calendarBillsRefreshRequestedRef.current = true;
        refreshLiveDataNow?.();
      }
      return makeCalendarBillsData(liveData, { pendingUpdate: billsCurrentRefreshing });
    },
    initialData: null,
    fetchRange: getCalendarBillsRange,
    emptyData: null,
    // Per-month caching (like deadlines): a wide ensure range is split into
    // <=2-month server fetches and merged, so bills span the whole mounted month
    // window instead of just the active month. prefetch warms the next edge month.
    cacheMode: "month",
    prefetchMonthRadius: 1,
  });
  const loadCalendarDeadlines = deadlinesCache.load;
  const loadCalendarBills = billsCache.load;
  const refreshCalendarDomains = useCallback(({ force = false, includeBills = true }: { force?: boolean; includeBills?: boolean } = {}) => {
    loadCalendarDeadlines({ force });
    if (includeBills) loadCalendarBills({ force });
  }, [loadCalendarBills, loadCalendarDeadlines]);
  useNotifications(liveData);
  const liveCalendar = liveData.liveCalendar;
  const liveLastFetched = liveData.lastFetched;
  useEffect(() => {
    triageNotificationSounds.handleCalendarSnapshot({
      liveCalendar,
      lastFetched: liveLastFetched,
    });
  }, [liveCalendar, liveLastFetched, triageNotificationSounds]);
  useEffect(() => {
    triageNotificationSounds.handleActiveSnapshot(activeSnapshot.snapshot);
  }, [activeSnapshot.snapshot, triageNotificationSounds]);
  const bd = currentDashboard.briefingData;
  const [currentSyncing, setCurrentSyncing] = useState(false);
  const [lastQuickRefreshAt, setLastQuickRefreshAt] = useState<number | null>(null);
  const calendarWorkspaceRef = useRef<DashboardCalendarWorkspaceState>({ open: false, view: "events", eventsRange: null });
  const markDeadlineRangeStale = deadlinesCache.range.markStale;
  const markBillRangeStale = billsCache.range.markStale;
  // Sync the SSE dashboard-event handler into its ref from an effect (not during
  // render) — the EventSource reads `.current` at fire-time, so re-binding after
  // each render that changes its closure is equivalent and keeps render pure.
  useEffect(() => {
    dashboardEventHandlerRef.current = (event: CurrentDashboardEventInput | null) => {
      triageNotificationSounds.handleDashboardEvent(event);
      const plan = resolveDashboardCurrentEventPlan(event || {});
      if (plan.markBillsRefreshRequested) {
        calendarBillsRefreshRequestedRef.current = true;
      }
      if (plan.markBillRangeStale) {
        markBillRangeStale?.();
      }
      if (plan.markDeadlineRangeStale) {
        markDeadlineRangeStale?.();
      }
      if (plan.refreshCalendarDomains) {
        refreshCalendarDomains(plan.refreshCalendarDomains);
      }
    };
  });
  const markCalendarRangeStale = calendarRange.markStale;
  const refreshCalendarRangeInPlace = calendarRange.refreshRangeInPlace;
  const runDashboardRefresh = useCallback((trigger: "timer" | "explicit") => {
    const plan = resolveDashboardRefreshPlan({
      trigger,
      currentSyncing: currentSyncing || sourceRetryPending,
      calendarWorkspace: calendarWorkspaceRef.current,
    });
    if (!plan.shouldRun) return Promise.resolve();
    setLastQuickRefreshAt(Date.now());
    setCurrentSyncing(true);
    if (plan.refreshVisibleEvents) {
      refreshCalendarRangeInPlace?.(plan.refreshVisibleEvents.start, plan.refreshVisibleEvents.end);
    }
    if (plan.markCalendarEventsStale) {
      markCalendarRangeStale?.(undefined, undefined);
    }
    if (plan.markBillsRefreshRequested) {
      calendarBillsRefreshRequestedRef.current = true;
    }
    if (plan.markDeadlineRangeStale) {
      markDeadlineRangeStale?.();
    }
    if (plan.markBillRangeStale) {
      markBillRangeStale?.();
    }
    if (plan.refreshCalendarDomains) {
      refreshCalendarDomains(plan.refreshCalendarDomains);
    }
    return withSyncWatchdog(activeSnapshot.sync()).finally(() => setCurrentSyncing(false));
  }, [activeSnapshot, currentSyncing, sourceRetryPending, markBillRangeStale, markCalendarRangeStale, markDeadlineRangeStale, refreshCalendarDomains, refreshCalendarRangeInPlace]);
  const handleTimerQuickRefresh = useCallback(() => {
    setLastQuickRefreshAt(Date.now());
    return refreshLiveDataNow?.() ?? Promise.resolve();
  }, [refreshLiveDataNow]);
  const handleExplicitQuickRefresh = useCallback(() => {
    return runDashboardRefresh("explicit");
  }, [runDashboardRefresh]);
  useAutoRefresh({
    lastQuickRefreshAt,
    onQuickRefresh: handleTimerQuickRefresh,
  });

  // R hotkey maps to the explicit Sync now action.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!shouldTriggerSyncHotkey({
        key: e.key,
        repeat: e.repeat,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: target ? { isContentEditable: target.isContentEditable, tagName: target.tagName } : null,
      }, {
        refreshing: bd.refreshing,
        syncing: currentSyncing,
        activeTab: document.documentElement.dataset.activeTab,
      })) return;
      handleExplicitQuickRefresh();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bd.refreshing, currentSyncing, handleExplicitQuickRefresh]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLDivElement | null>(null);

  // Re-snapshot bills once the live refresh requested via {refreshLive} lands.
  useEffect(() => {
    if (!calendarBillsRefreshRequestedRef.current) return;
    calendarBillsRefreshRequestedRef.current = false;
    loadCalendarBills({ force: true });
  }, [billsCurrentRefreshing, liveData.actualBudgetUrl, liveData.allSchedules, liveData.billsSyncHealth, liveData.lastFetched, liveData.payeeMap, loadCalendarBills]);

  // Clear a pendingUpdate snapshot once the bills_current source settles.
  const calendarBillsPendingUpdate = billsCache.data?.pendingUpdate;
  useEffect(() => {
    if (!calendarBillsPendingUpdate || billsCurrentRefreshing) return;
    loadCalendarBills({ force: true });
  }, [billsCurrentRefreshing, calendarBillsPendingUpdate, loadCalendarBills]);

  const updateCalendarWorkspace = useCallback((snapshot: DashboardCalendarWorkspaceState) => {
    calendarWorkspaceRef.current = {
      ...calendarWorkspaceRef.current,
      ...snapshot,
    };
  }, []);

  const briefingState = resolveDashboardBriefingState({
    loading: bd.loading,
    error: bd.error,
    briefing: bd.briefing,
    activeSnapshot: activeSnapshot.snapshot,
  });
  const { effectiveBriefing } = briefingState;
  const shellBd = useMemo(
    () => ({
      ...(effectiveBriefing === bd.briefing ? bd : { ...bd, briefing: effectiveBriefing }),
      refreshing: bd.refreshing || currentSyncing,
    }),
    [bd, currentSyncing, effectiveBriefing],
  );

  if (briefingState.view === "loading") return <LoadingSkeleton />;
  if (briefingState.view === "error") {
    return <ErrorState message={briefingState.error} onRetry={() => window.location.reload()} />;
  }
  if (briefingState.view === "empty") {
    return (
      <div className="min-h-screen text-foreground font-sans flex items-center justify-center p-6">
        <div className="w-full max-w-[880px]">
          <EmptyStateSplash
            icon={<Sun size={46} className="text-[var(--sp-cream)]" />}
            eyebrow="Current dashboard"
            title="No current snapshot yet"
            message="Connect the inboxes and services that feed the dashboard, then sync current data to seed the workspace."
            actions={(
              <>
                <Button onClick={handleExplicitQuickRefresh}>Sync now</Button>
                <Button variant="outline" nativeButton={false} render={<Link to="/settings" />}>Settings</Button>
              </>
            )}
            minHeight={360}
          />
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <DashboardProvider
        deadlines={deadlinesCache.data ?? liveData.liveDeadlines as DashboardDeadlineRoot}
        setCalendarDeadlines={deadlinesCache.update}
        onTaskCompletionIntent={triageNotificationSounds.handleTaskCompleted}
      >
        <DashboardShell
          bd={shellBd}
          liveData={liveData}
          activeSnapshot={activeSnapshot}
          calendarRange={calendarRange}
          onQuickRefresh={handleExplicitQuickRefresh}
          onRetrySource={currentDashboard.retrySource}
          sourceRetry={currentDashboard.sourceRetry}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyTriggerRef={historyTriggerRef}
          calendarDeadlines={deadlinesCache.data}
          calendarDeadlinesLoading={deadlinesCache.loading}
          calendarDeadlinesError={deadlinesCache.error}
          domainRefreshing={domainRefreshing}
          loadCalendarDeadlines={loadCalendarDeadlines}
          calendarBillsData={billsCache.data}
          calendarBillRange={billsCache.range as DashboardCalendarModalMountProps["calendarBillRange"]}
          calendarDeadlineRange={deadlinesCache.range as DashboardCalendarModalMountProps["calendarDeadlineRange"]}
          loadCalendarBills={loadCalendarBills}
          onCalendarWorkspaceChange={updateCalendarWorkspace}
        />
      </DashboardProvider>
    </TooltipProvider>
  );
}

export { DashboardShell, DashboardBody };
