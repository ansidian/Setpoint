import { useState, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { getCalendarDeadlines } from "../api";
import LoadingSkeleton from "../components/layout/LoadingSkeleton";
import ErrorState from "../components/layout/ErrorState";
import RefreshBanner from "../components/layout/RefreshBanner";
import { Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardProvider } from "../context/DashboardContext";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import useLiveData from "../hooks/useLiveData";
import useHoldGesture from "../hooks/useHoldGesture";
import useBriefingData from "../hooks/useBriefingData";
import useAutoRefresh from "../hooks/useAutoRefresh";
import useNotifications from "../hooks/useNotifications";
import useCalendarRange from "../hooks/useCalendarRange";
import { RedesignShell, DashboardBody } from "../components/dashboard/RedesignShell";
import { reconcileBriefingReadStatus } from "../lib/briefing-email-state";
import EmptyStateSplash from "../components/shared/EmptyStateSplash";

const DevPanel = import.meta.env.DEV ? lazy(() => import("../components/dev/DevPanel.jsx")) : null;
const CALENDAR_DOMAIN_CACHE_TTL_MS = 30 * 60 * 1000;

function isCalendarDomainCacheStale(fetchedAt) {
  return !fetchedAt || Date.now() - fetchedAt > CALENDAR_DOMAIN_CACHE_TTL_MS;
}

export default function Dashboard() {
  const [isMock, setIsMock] = useState(() =>
    new URLSearchParams(window.location.search).has("mock"),
  );

  useEffect(() => {
    const handler = (e) => setIsMock(e.detail.scenarios != null);
    window.addEventListener("devpanel:apply", handler);
    return () => window.removeEventListener("devpanel:apply", handler);
  }, []);

  const liveData = useLiveData({ disabled: isMock });
  const calendarRange = useCalendarRange({ disabled: isMock });
  useNotifications(liveData);
  const bd = useBriefingData({ liveData, isMock });
  const refreshCalendarDomainsRef = useRef(null);
  const calendarWorkspaceRef = useRef({ open: false, view: "events", eventsRange: null });
  const calendarBillsRefreshRequestedRef = useRef(false);
  const markCalendarRangeStale = calendarRange.markStale;
  const refreshCalendarRangeInPlace = calendarRange.refreshRangeInPlace;
  const quickRefreshBriefing = bd.handleQuickRefresh;
  const handleTimerQuickRefresh = useCallback(() => {
    return quickRefreshBriefing();
  }, [quickRefreshBriefing]);
  const handleExplicitQuickRefresh = useCallback(() => {
    const calendarWorkspace = calendarWorkspaceRef.current;
    if (calendarWorkspace.open && calendarWorkspace.view === "events" && calendarWorkspace.eventsRange) {
      refreshCalendarRangeInPlace?.(calendarWorkspace.eventsRange.start, calendarWorkspace.eventsRange.end);
    } else {
      markCalendarRangeStale?.();
    }
    calendarBillsRefreshRequestedRef.current = true;
    refreshCalendarDomainsRef.current?.({ force: true });
    return quickRefreshBriefing();
  }, [markCalendarRangeStale, quickRefreshBriefing, refreshCalendarRangeInPlace]);
  const refreshHold = useHoldGesture({ onShortPress: handleExplicitQuickRefresh });

  useAutoRefresh({
    disabled: isMock,
    lastQuickRefreshAt: bd.lastQuickRefreshAt,
    onQuickRefresh: handleTimerQuickRefresh,
  });

  const handleFullGeneration = useCallback(async () => {
    refreshHold.setShowConfirm(false);
    bd.handleFullGeneration();
  }, [refreshHold, bd]);

  // R hotkey (same as before). Also wire Escape to dismiss the generate
  // confirmation so the user can back out without mouse.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Escape" && refreshHold.showConfirm) {
        refreshHold.setShowConfirm(false);
        return;
      }
      if (e.repeat || e.key !== "r") return;
      if (bd.refreshing || bd.generating) return;
      if (refreshHold.showConfirm) { handleFullGeneration(); return; }
      refreshHold.startHold();
    }
    function onKeyUp(e) {
      if (e.key !== "r") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (!refreshHold.holdTimerRef.current) return;
      refreshHold.endHold(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // Reconcile briefing read status from live data (kept from original)
  useEffect(() => {
    const status = liveData.briefingReadStatus;
    if (!status || !Object.keys(status).length) return;
    bd.setBriefing((prev) => reconcileBriefingReadStatus(prev, status));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bd.setBriefing is stable
  }, [liveData.briefingReadStatus]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef(null);

  const [calendarDeadlines, setCalendarDeadlines] = useState(null);
  const [calendarDeadlinesLoading, setCalendarDeadlinesLoading] = useState(false);
  const [calendarDeadlinesFetchedAt, setCalendarDeadlinesFetchedAt] = useState(0);
  const calendarDeadlinesLoadingRef = useRef(false);
  const loadCalendarDeadlines = useCallback((opts) => {
    const force = !!opts?.force;
    if (calendarDeadlinesLoadingRef.current && !force) return;
    if (!force && calendarDeadlines && !isCalendarDomainCacheStale(calendarDeadlinesFetchedAt)) return;
    calendarDeadlinesLoadingRef.current = true;
    setCalendarDeadlinesLoading(true);
    getCalendarDeadlines()
      .then((data) => {
        setCalendarDeadlines(data);
        setCalendarDeadlinesFetchedAt(Date.now());
      })
      .catch((err) => console.error("Calendar deadlines fetch failed:", err))
      .finally(() => {
        calendarDeadlinesLoadingRef.current = false;
        setCalendarDeadlinesLoading(false);
      });
  }, [calendarDeadlines, calendarDeadlinesFetchedAt]);

  const [calendarBillsData, setCalendarBillsData] = useState(null);
  const [calendarBillsFetchedAt, setCalendarBillsFetchedAt] = useState(0);
  const refreshLiveDataNow = liveData.refreshNow;
  const snapshotCalendarBills = useCallback(() => {
    setCalendarBillsData({
      schedules: liveData.allSchedules || [],
      recentTransactions: liveData.recentTransactions || [],
      payeeMap: liveData.payeeMap || {},
      actualBudgetUrl: liveData.actualBudgetUrl,
    });
    setCalendarBillsFetchedAt(Date.now());
  }, [liveData.actualBudgetUrl, liveData.allSchedules, liveData.payeeMap, liveData.recentTransactions]);
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

  if (bd.loading) return <LoadingSkeleton />;
  if (bd.error && !bd.briefing) {
    return <ErrorState message={bd.error} onRetry={() => window.location.reload()} />;
  }
  if (!bd.briefing) {
    return (
      <div className="min-h-screen text-foreground font-sans flex items-center justify-center p-6">
        <div className="w-full max-w-[880px]">
          <EmptyStateSplash
            icon={<Sun size={46} className="text-[#f9e2af]" />}
            eyebrow="Briefings"
            title="No briefings yet"
            message="Connect the inboxes and services that feed the dashboard, then generate the first briefing to seed the workspace."
            actions={(
              <>
                <Button onClick={handleFullGeneration}>Generate First Briefing</Button>
                <Button variant="outline" asChild><Link to="/settings">Settings</Link></Button>
              </>
            )}
            minHeight={360}
          />
          {bd.generating && <div className="mt-4"><RefreshBanner progress={bd.genProgress} /></div>}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <DashboardProvider
        briefing={bd.briefing}
        setBriefing={bd.setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
      >
        <RedesignShell
          bd={bd}
          liveData={liveData}
          calendarRange={calendarRange}
          isMock={isMock}
          refreshHold={refreshHold}
          handleFullGeneration={handleFullGeneration}
          onQuickRefresh={handleExplicitQuickRefresh}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyTriggerRef={historyTriggerRef}
          calendarDeadlines={calendarDeadlines}
          calendarDeadlinesLoading={calendarDeadlinesLoading}
          loadCalendarDeadlines={loadCalendarDeadlines}
          calendarBillsData={calendarBillsData}
          loadCalendarBills={loadCalendarBills}
          onCalendarWorkspaceChange={updateCalendarWorkspace}
        />
        {DevPanel && (
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        )}
      </DashboardProvider>
    </TooltipProvider>
  );
}

export { RedesignShell, DashboardBody };
