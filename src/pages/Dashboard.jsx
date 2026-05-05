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
import useCalendarDomainRange from "../hooks/useCalendarDomainRange";
import useCalendarRange from "../hooks/useCalendarRange";
import { RedesignShell, DashboardBody } from "../components/dashboard/RedesignShell";
import { reconcileBriefingReadStatus } from "../lib/briefing-email-state";
import EmptyStateSplash from "../components/shared/EmptyStateSplash";
import { resolveDashboardBriefingState } from "./Dashboard.bootState";

const CALENDAR_DOMAIN_CACHE_TTL_MS = 30 * 60 * 1000;
const SYNC_WATCHDOG_MS = 45_000;

function isCalendarDomainCacheStale(fetchedAt) {
  return !fetchedAt || Date.now() - fetchedAt > CALENDAR_DOMAIN_CACHE_TTL_MS;
}

function withSyncWatchdog(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, SYNC_WATCHDOG_MS)),
  ]);
}

export default function Dashboard() {
  const currentDashboard = useCurrentDashboard();
  const liveData = currentDashboard.liveData;
  const activeSnapshot = currentDashboard.activeSnapshot;
  const calendarRange = useCalendarRange();
  const calendarDeadlineRange = useCalendarDomainRange({
    fetchRange: getCalendarDeadlinesRange,
    emptyData: null,
  });
  const calendarBillRange = useCalendarDomainRange({
    fetchRange: getCalendarBillsRange,
    emptyData: null,
  });
  useNotifications(liveData);
  const bd = currentDashboard.briefingData;
  const [currentSyncing, setCurrentSyncing] = useState(false);
  const [lastQuickRefreshAt, setLastQuickRefreshAt] = useState(null);
  const refreshCalendarDomainsRef = useRef(null);
  const calendarWorkspaceRef = useRef({ open: false, view: "events", eventsRange: null });
  const calendarBillsRefreshRequestedRef = useRef(false);
  const markCalendarRangeStale = calendarRange.markStale;
  const refreshCalendarRangeInPlace = calendarRange.refreshRangeInPlace;
  const handleTimerQuickRefresh = useCallback(() => {
    if (currentSyncing) return Promise.resolve();
    setLastQuickRefreshAt(Date.now());
    setCurrentSyncing(true);
    return withSyncWatchdog(liveData.refreshNow?.()).finally(() => setCurrentSyncing(false));
  }, [currentSyncing, liveData]);
  const handleExplicitQuickRefresh = useCallback(() => {
    if (currentSyncing) return Promise.resolve();
    setLastQuickRefreshAt(Date.now());
    setCurrentSyncing(true);
    const calendarWorkspace = calendarWorkspaceRef.current;
    if (calendarWorkspace.open && calendarWorkspace.view === "events" && calendarWorkspace.eventsRange) {
      refreshCalendarRangeInPlace?.(calendarWorkspace.eventsRange.start, calendarWorkspace.eventsRange.end);
    } else {
      markCalendarRangeStale?.();
    }
    calendarBillsRefreshRequestedRef.current = true;
    calendarDeadlineRange.markStale?.();
    calendarBillRange.markStale?.();
    refreshCalendarDomainsRef.current?.({ force: true });
    return withSyncWatchdog(activeSnapshot.sync?.()).finally(() => setCurrentSyncing(false));
  }, [activeSnapshot, calendarBillRange, calendarDeadlineRange, currentSyncing, markCalendarRangeStale, refreshCalendarRangeInPlace]);
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

  // Reconcile briefing read status from live data (kept from original)
  useEffect(() => {
    const status = liveData.briefingReadStatus;
    if (!status || !Object.keys(status).length) return;
    bd.setBriefing((prev) => reconcileBriefingReadStatus(prev, status));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bd.setBriefing is stable
  }, [liveData.briefingReadStatus]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef(null);

  const [calendarDeadlines, setCalendarDeadlines] = useState(undefined);
  const [calendarDeadlinesLoading, setCalendarDeadlinesLoading] = useState(false);
  const [calendarDeadlinesError, setCalendarDeadlinesError] = useState(false);
  const [calendarDeadlinesFetchedAt, setCalendarDeadlinesFetchedAt] = useState(0);
  const updateCalendarDeadlineRangeData = calendarDeadlineRange.updateData;
  const calendarDeadlinesLoadingRef = useRef(false);
  const loadCalendarDeadlines = useCallback((opts) => {
    const force = !!opts?.force;
    if (calendarDeadlinesLoadingRef.current && !force) return;
    if (!force && calendarDeadlines && !isCalendarDomainCacheStale(calendarDeadlinesFetchedAt)) return;
    calendarDeadlinesLoadingRef.current = true;
    setCalendarDeadlinesError(false);
    setCalendarDeadlinesLoading(true);
    getCalendarDeadlines()
      .then((data) => {
        setCalendarDeadlines(data);
        setCalendarDeadlinesFetchedAt(Date.now());
      })
      .catch((err) => {
        console.error("Calendar deadlines fetch failed:", err);
        setCalendarDeadlinesError(true);
      })
      .finally(() => {
        calendarDeadlinesLoadingRef.current = false;
        setCalendarDeadlinesLoading(false);
      });
  }, [calendarDeadlines, calendarDeadlinesFetchedAt]);
  const updateCalendarDeadlinesLocal = useCallback((updater) => {
    setCalendarDeadlines(updater);
    updateCalendarDeadlineRangeData?.(updater);
  }, [updateCalendarDeadlineRangeData]);

  const [calendarBillsData, setCalendarBillsData] = useState(null);
  const [calendarBillsFetchedAt, setCalendarBillsFetchedAt] = useState(0);
  const refreshLiveDataNow = liveData.refreshNow;
  const snapshotCalendarBills = useCallback(() => {
    setCalendarBillsData({
      schedules: (liveData.allSchedules || []).map((schedule) => ({ ...schedule, paid: false })),
      recentTransactions: [],
      payeeMap: liveData.payeeMap || {},
      actualBudgetUrl: liveData.actualBudgetUrl,
    });
    setCalendarBillsFetchedAt(Date.now());
  }, [liveData.actualBudgetUrl, liveData.allSchedules, liveData.payeeMap]);
  const loadCalendarBills = useCallback((opts) => {
    const force = !!opts?.force;
    const stale = isCalendarDomainCacheStale(calendarBillsFetchedAt);
    if (!force && calendarBillsData && !stale) return;
    if (opts?.refreshLive) {
      calendarBillsRefreshRequestedRef.current = true;
      refreshLiveDataNow?.();
    }
    snapshotCalendarBills();
  }, [calendarBillsData, calendarBillsFetchedAt, refreshLiveDataNow, snapshotCalendarBills]);

  useEffect(() => {
    if (!calendarBillsRefreshRequestedRef.current) return;
    calendarBillsRefreshRequestedRef.current = false;
    snapshotCalendarBills();
  }, [liveData.lastFetched, snapshotCalendarBills]);

  useEffect(() => {
    refreshCalendarDomainsRef.current = ({ force = false } = {}) => {
      loadCalendarDeadlines({ force });
      loadCalendarBills({ force });
    };
  }, [loadCalendarBills, loadCalendarDeadlines]);

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
            icon={<Sun size={46} className="text-[#f9e2af]" />}
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
        briefing={effectiveBriefing}
        setBriefing={bd.setBriefing}
        setCalendarDeadlines={updateCalendarDeadlinesLocal}
      >
        <RedesignShell
          bd={shellBd}
          liveData={liveData}
          activeSnapshot={activeSnapshot}
          calendarRange={calendarRange}
          onQuickRefresh={handleExplicitQuickRefresh}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyTriggerRef={historyTriggerRef}
          calendarDeadlines={calendarDeadlines}
          calendarDeadlinesLoading={calendarDeadlinesLoading}
          calendarDeadlinesError={calendarDeadlinesError}
          loadCalendarDeadlines={loadCalendarDeadlines}
          calendarBillsData={calendarBillsData}
          calendarBillRange={calendarBillRange}
          calendarDeadlineRange={calendarDeadlineRange}
          loadCalendarBills={loadCalendarBills}
          onCalendarWorkspaceChange={updateCalendarWorkspace}
        />
      </DashboardProvider>
    </TooltipProvider>
  );
}

export { RedesignShell, DashboardBody };
