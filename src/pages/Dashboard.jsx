import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getCalendarBillsRange, getCalendarDeadlines, getCalendarDeadlinesRange } from "../api";
import LoadingSkeleton from "../components/layout/LoadingSkeleton";
import ErrorState from "../components/layout/ErrorState";
import { Sun } from "lucide-react";
import { Link } from "react-router-dom";
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
} from "./Dashboard.refreshModel";

const SYNC_WATCHDOG_MS = 45_000;

function withSyncWatchdog(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, SYNC_WATCHDOG_MS)),
  ]);
}

export default function Dashboard() {
  const triageNotificationSounds = useTriageNotificationSounds();
  const dashboardEventHandlerRef = useRef(null);
  const currentDashboard = useCurrentDashboard({
    onDashboardEvent: (event) => dashboardEventHandlerRef.current?.(event),
  });
  const liveData = currentDashboard.liveData;
  const activeSnapshot = currentDashboard.activeSnapshot;
  const calendarRange = useCalendarRange();
  const calendarBillsRefreshRequestedRef = useRef(false);
  const refreshLiveDataNow = liveData.refreshNow;
  const billsCurrentRefreshing = liveData.providerHealth?.currentData?.sources?.some((source) =>
    source.key === "bills_current" && source.state === "refreshing",
  );
  const deadlinesCache = useStaleDomainCache({
    fetchDomain: getCalendarDeadlines,
    seed: Array.isArray(liveData.liveDeadlines?.upcoming) ? liveData.liveDeadlines : null,
    fetchRange: getCalendarDeadlinesRange,
    emptyData: null,
    cacheMode: "month",
    prefetchMonthRadius: 1,
  });
  const billsCache = useStaleDomainCache({
    fetchDomain: (opts) => {
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
  const refreshCalendarDomains = useCallback(({ force = false, includeBills = true } = {}) => {
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
  const [lastQuickRefreshAt, setLastQuickRefreshAt] = useState(null);
  const calendarWorkspaceRef = useRef({ open: false, view: "events", eventsRange: null });
  const markDeadlineRangeStale = deadlinesCache.range.markStale;
  const markBillRangeStale = billsCache.range.markStale;
  // Sync the SSE dashboard-event handler into its ref from an effect (not during
  // render) — the EventSource reads `.current` at fire-time, so re-binding after
  // each render that changes its closure is equivalent and keeps render pure.
  useEffect(() => {
    dashboardEventHandlerRef.current = (event) => {
      triageNotificationSounds.handleDashboardEvent(event);
      const plan = resolveDashboardCurrentEventPlan(event);
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
  const runDashboardRefresh = useCallback((trigger) => {
    const plan = resolveDashboardRefreshPlan({
      trigger,
      currentSyncing,
      calendarWorkspace: calendarWorkspaceRef.current,
    });
    if (!plan.shouldRun) return Promise.resolve();
    setLastQuickRefreshAt(Date.now());
    setCurrentSyncing(true);
    if (plan.refreshVisibleEvents) {
      refreshCalendarRangeInPlace?.(plan.refreshVisibleEvents.start, plan.refreshVisibleEvents.end);
    }
    if (plan.markCalendarEventsStale) {
      markCalendarRangeStale?.();
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
    return withSyncWatchdog(activeSnapshot.sync?.()).finally(() => setCurrentSyncing(false));
  }, [activeSnapshot, currentSyncing, markBillRangeStale, markCalendarRangeStale, markDeadlineRangeStale, refreshCalendarDomains, refreshCalendarRangeInPlace]);
  const handleTimerQuickRefresh = useCallback(() => (
    runDashboardRefresh("timer")
  ), [runDashboardRefresh]);
  const handleExplicitQuickRefresh = useCallback(() => {
    return runDashboardRefresh("explicit");
  }, [runDashboardRefresh]);
  useAutoRefresh({
    lastQuickRefreshAt,
    onQuickRefresh: handleTimerQuickRefresh,
  });

  // R hotkey maps to the explicit Sync now action.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.repeat || e.key !== "r") return;
      if (bd.refreshing || currentSyncing) return;
      handleExplicitQuickRefresh();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bd.refreshing, currentSyncing, handleExplicitQuickRefresh]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef(null);

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

  const updateCalendarWorkspace = useCallback((snapshot) => {
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
    return <ErrorState message={bd.error} onRetry={() => window.location.reload()} />;
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
                <Button variant="outline" asChild><Link to="/settings">Settings</Link></Button>
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
        deadlines={deadlinesCache.data ?? liveData.liveDeadlines}
        setCalendarDeadlines={deadlinesCache.update}
        onTaskCompletionIntent={triageNotificationSounds.handleTaskCompleted}
      >
        <DashboardShell
          bd={shellBd}
          liveData={liveData}
          activeSnapshot={activeSnapshot}
          calendarRange={calendarRange}
          onQuickRefresh={handleExplicitQuickRefresh}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyTriggerRef={historyTriggerRef}
          calendarDeadlines={deadlinesCache.data}
          calendarDeadlinesLoading={deadlinesCache.loading}
          calendarDeadlinesError={deadlinesCache.error}
          loadCalendarDeadlines={loadCalendarDeadlines}
          calendarBillsData={billsCache.data}
          calendarBillRange={billsCache.range}
          calendarDeadlineRange={deadlinesCache.range}
          loadCalendarBills={loadCalendarBills}
          onCalendarWorkspaceChange={updateCalendarWorkspace}
        />
      </DashboardProvider>
    </TooltipProvider>
  );
}

export { DashboardShell, DashboardBody };
