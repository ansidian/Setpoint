import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
import { motion as Motion } from "motion/react";
import { getCalendarDeadlines, deleteBriefing } from "../api";
import LoadingSkeleton from "../components/layout/LoadingSkeleton";
import ErrorState from "../components/layout/ErrorState";
import RefreshBanner from "../components/layout/RefreshBanner";
import CalendarModal from "../components/calendar/CalendarModal";
import BriefingHistoryPanel from "../components/briefing/BriefingHistoryPanel";
import ShellHeader from "../components/shell/ShellHeader";
import CommandPalette from "../components/shell/CommandPalette";
import CustomizePanel from "../components/shell/CustomizePanel";
import DashboardHero from "../components/dashboard/DashboardHero";
import TodayTimeline from "../components/dashboard/TodayTimeline";
import { InsightsRail, DeadlinesRail, BillsRail, InboxPeek } from "../components/dashboard/rails/Rails";
import NotesRail from "../components/notes/NotesRail";
import DeadlineDetailPopover from "../components/dashboard/DeadlineDetailPopover";
import InboxView from "../components/inbox/InboxView";
import { Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardProvider, useDashboard } from "../context/DashboardContext";
import { Button } from "@/components/ui/button";
import useLiveData from "../hooks/useLiveData";
import useHoldGesture from "../hooks/useHoldGesture";
import useBriefingData from "../hooks/useBriefingData";
import useAutoRefresh from "../hooks/useAutoRefresh";
import useNotifications from "../hooks/useNotifications";
import useCustomize from "../hooks/useCustomize";
import useCalendarRange from "../hooks/useCalendarRange";
import useIsMobile from "../hooks/useIsMobile";
import useBrowserBackDismiss from "../hooks/useBrowserBackDismiss";
import { focusPressureDate } from "../lib/focus-windows";
import { mergeReadState } from "../components/inbox/helpers";

const DevPanel = import.meta.env.DEV ? lazy(() => import("../components/dev/DevPanel.jsx")) : null;

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
  const invalidateCalendarRange = calendarRange.invalidate;
  const quickRefreshBriefing = bd.handleQuickRefresh;
  const handleCalendarAwareQuickRefresh = useCallback(() => {
    invalidateCalendarRange();
    return quickRefreshBriefing();
  }, [invalidateCalendarRange, quickRefreshBriefing]);
  const refreshHold = useHoldGesture({ onShortPress: handleCalendarAwareQuickRefresh });

  useAutoRefresh({
    disabled: isMock,
    lastQuickRefreshAt: bd.lastQuickRefreshAt,
    onQuickRefresh: handleCalendarAwareQuickRefresh,
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
    bd.setBriefing((prev) => {
      if (!prev?.emails?.accounts) return prev;
      let changed = false;
      const accounts = prev.emails.accounts.map((acct) => {
        const important = acct.important.map((e) => {
          const key = e.uid || e.id;
          if (!key || !Object.prototype.hasOwnProperty.call(status, key)) return e;
          const nextRead = !!status[key];
          if (e.read !== nextRead) {
            changed = true;
            return { ...e, read: nextRead };
          }
          return e;
        });
        if (important === acct.important) return acct;
        return { ...acct, important, unread: important.filter((email) => !email.read).length };
      });
      return changed ? { ...prev, emails: { ...prev.emails, accounts } } : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bd.setBriefing is stable
  }, [liveData.briefingReadStatus]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef(null);

  const [calendarDeadlines, setCalendarDeadlines] = useState(null);
  const calendarDeadlinesLoadingRef = useRef(false);
  const loadCalendarDeadlines = (opts) => {
    if (calendarDeadlinesLoadingRef.current && !opts?.force) return;
    calendarDeadlinesLoadingRef.current = true;
    getCalendarDeadlines()
      .then((data) => setCalendarDeadlines(data))
      .catch((err) => console.error("Calendar deadlines fetch failed:", err))
      .finally(() => { calendarDeadlinesLoadingRef.current = false; });
  };

  useEffect(() => {
    if (calendarDeadlines !== null) loadCalendarDeadlines({ force: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bd.lastQuickRefreshAt, bd.latestId]);

  if (bd.loading) return <LoadingSkeleton />;
  if (bd.error && !bd.briefing) {
    return <ErrorState message={bd.error} onRetry={() => window.location.reload()} />;
  }
  if (!bd.briefing) {
    return (
      <div className="min-h-screen text-foreground font-sans flex flex-col items-center justify-center gap-4 p-6">
        <Sun size={48} className="text-[#f9e2af]" />
        <h1 className="ea-display text-[28px] font-normal text-[#f8fafc] m-0">
          No briefings yet
        </h1>
        <p className="text-sm text-muted-foreground m-0 text-center max-w-[400px]">
          Connect your email accounts in Settings, then generate your first briefing.
        </p>
        <div className="flex gap-3 mt-2">
          <Button onClick={handleFullGeneration}>Generate First Briefing</Button>
          <Button variant="outline" asChild><Link to="/settings">Settings</Link></Button>
        </div>
        {bd.generating && <div className="mt-4"><RefreshBanner progress={bd.genProgress} /></div>}
      </div>
    );
  }

  return (
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
        onQuickRefresh={handleCalendarAwareQuickRefresh}
        historyOpen={historyOpen}
        setHistoryOpen={setHistoryOpen}
        historyTriggerRef={historyTriggerRef}
        calendarDeadlines={calendarDeadlines}
        loadCalendarDeadlines={loadCalendarDeadlines}
      />
      {DevPanel && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </DashboardProvider>
  );
}

/* ======================================================================
 * REDESIGN SHELL — tabs + palette + customize + routed body
 * ====================================================================== */
export function RedesignShell({
  bd, liveData, calendarRange, isMock = false, refreshHold, handleFullGeneration,
  onQuickRefresh,
  historyOpen, setHistoryOpen, historyTriggerRef,
  calendarDeadlines, loadCalendarDeadlines,
}) {
  const customize = useCustomize();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem("ea:tab");
      return saved === "inbox" ? "inbox" : "dashboard";
    } catch {
      return "dashboard";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("ea:tab", tab); } catch { /* ignore */ }
  }, [tab]);
  const dismissMobileInboxTab = useBrowserBackDismiss({
    enabled: isMobile && tab === "inbox",
    historyKey: "eaDashboardMobileTab",
    onDismiss: () => setTab("dashboard"),
  });
  const setShellTab = useCallback((nextTab) => {
    if (nextTab !== "dashboard" && nextTab !== "inbox") return;
    if (!isMobile || nextTab === tab) {
      setTab(nextTab);
      return;
    }
    if (tab === "inbox" && nextTab === "dashboard") {
      dismissMobileInboxTab();
      return;
    }
    setTab(nextTab);
  }, [dismissMobileInboxTab, isMobile, tab]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [liveReadOverrides, setLiveReadOverrides] = useState({});

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarView, setCalendarView] = useState(() => {
    try {
      const saved = localStorage.getItem("calendar:lastView");
      if (saved === "deadlines" || saved === "bills" || saved === "events") return saved;
      return "events";
    } catch { return "events"; }
  });
  const showBills = !!liveData.actualConfigured;
  const [calendarFocus, setCalendarFocus] = useState(null);
  const [calendarFocusItemId, setCalendarFocusItemId] = useState(null);
  const dismissCalendar = useBrowserBackDismiss({
    enabled: !isMobile && calendarOpen,
    historyKey: "eaDashboardCalendarModal",
    onDismiss: () => setCalendarOpen(false),
  });
  const openCalendar = (viewKey, focusDate = null, focusItemId = null) => {
    if (isMobile) return;
    const resolved = viewKey === "bills" && !showBills ? "deadlines" : viewKey || calendarView;
    setCalendarView(resolved);
    try { localStorage.setItem("calendar:lastView", resolved); } catch { /* ignore */ }
    setCalendarFocus(focusDate || null);
    setCalendarFocusItemId(focusItemId ? String(focusItemId) : null);
    setCalendarOpen(true);
    if (resolved === "deadlines") loadCalendarDeadlines();
  };
  const changeCalendarView = (v) => {
    setCalendarView(v);
    try { localStorage.setItem("calendar:lastView", v); } catch { /* ignore */ }
    if (v === "deadlines") loadCalendarDeadlines();
  };

  useEffect(() => {
    if (isMobile && calendarOpen) setCalendarOpen(false);
  }, [isMobile, calendarOpen]);

  // Global hotkeys: ⌘K palette, c calendar
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" && !calendarOpen) { openCalendar(); }
      if (e.key === "h") { setHistoryOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarOpen, isMobile]);

  const { accent } = customize;
  const briefing = bd.briefing;

  // Scroll/jump to data-sect targets within the dashboard tab
  const jumpToSection = useCallback((slug) => {
    setShellTab("dashboard");
    setTimeout(() => {
      const el = document.querySelector(`[data-sect="${slug}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [setShellTab]);

  // Email click anywhere → switch to inbox and let its state handle selection.
  const [inboxSeedId, setInboxSeedId] = useState(null);
  const openEmailInInbox = useCallback((id) => {
    setInboxSeedId(id);
    setShellTab("inbox");
  }, [setShellTab]);

  // Deadline detail popover (anchored to the clicked row)
  const [deadlinePopover, setDeadlinePopover] = useState(null);

  const handlePaletteAction = useCallback((item) => {
    if (item.kind === "tab") setShellTab(item.payload);
    else if (item.kind === "scroll") jumpToSection(item.payload);
    else if (item.kind === "calendar") openCalendar();
    else if (item.kind === "history") setHistoryOpen(true);
    else if (item.kind === "customize") setCustomizeOpen(true);
    else if (item.kind === "refresh") onQuickRefresh?.();
    else if (item.kind === "regenerate") handleFullGeneration();
    else if (item.kind === "settings") window.location.href = "/settings";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToSection, onQuickRefresh, handleFullGeneration, setShellTab]);

  const eventsData = useMemo(() => ({
    ensureRange: calendarRange.ensureRange,
    refreshRange: calendarRange.refreshRange,
    getEvents: calendarRange.getEvents,
    hasMonth: calendarRange.hasMonth,
    isMonthLoading: calendarRange.isMonthLoading,
    loading: calendarRange.loading,
    error: calendarRange.error,
    revision: calendarRange.revision,
    editable: !isMock,
  }), [
    calendarRange.ensureRange,
    calendarRange.refreshRange,
    calendarRange.getEvents,
    calendarRange.hasMonth,
    calendarRange.isMonthLoading,
    calendarRange.loading,
    calendarRange.error,
    calendarRange.revision,
    isMock,
  ]);

  const nextBriefingLabel = formatNextBriefingLabel(bd.schedules);

  useEffect(() => {
    const activeUids = new Set();
    for (const email of liveData.liveEmails || []) {
      if (email?.uid) activeUids.add(email.uid);
    }
    for (const entry of liveData.resurfacedEntries || []) {
      if (entry?.uid) activeUids.add(entry.uid);
    }
    setLiveReadOverrides((prev) => {
      const next = {};
      let changed = false;
      for (const [uid, read] of Object.entries(prev)) {
        if (activeUids.has(uid)) next[uid] = read;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [liveData.liveEmails, liveData.resurfacedEntries]);

  const handleLiveReadOverrideChange = useCallback((uid, read) => {
    if (!uid) return;
    setLiveReadOverrides((prev) => {
      if (prev[uid] === read) return prev;
      return { ...prev, [uid]: !!read };
    });
  }, []);

  // Unread-live count surfaced on the Inbox tab. Drives the little blue pill
  // next to the tab label so the user notices new untriaged email without
  // first switching away from the dashboard.
  const liveUnreadCount = useMemo(() => {
    const seen = new Set();
    let unread = 0;

    for (const email of liveData.liveEmails || []) {
      if (!email?.uid || seen.has(email.uid)) continue;
      seen.add(email.uid);
      if (!mergeReadState(email.read, email.uid, liveReadOverrides)) unread += 1;
    }

    for (const entry of liveData.resurfacedEntries || []) {
      const uid = entry?.uid;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      if (!mergeReadState(entry.read, uid, liveReadOverrides)) unread += 1;
    }

    return unread;
  }, [liveData.liveEmails, liveData.resurfacedEntries, liveReadOverrides]);

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        display: "flex", flexDirection: "column",
        background: "radial-gradient(ellipse at top, #1a1a2a, #0b0b13 60%)",
        color: "#cdd6f4",
        overflow: "hidden",
      }}
    >
      {bd.generating && <RefreshBanner progress={bd.genProgress} />}

      <ShellHeader
        accent={accent}
        isMobile={isMobile}
        tab={tab}
        onTab={setShellTab}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenCustomize={() => setCustomizeOpen((v) => !v)}
        onOpenHistory={() => setHistoryOpen((v) => !v)}
        onOpenCalendar={() => openCalendar()}
        nextBriefingLabel={nextBriefingLabel}
        liveUnreadCount={liveUnreadCount}
        refreshHold={refreshHold}
        refreshing={bd.refreshing}
        generating={bd.generating}
        onQuickRefresh={onQuickRefresh}
        onFullGenerate={handleFullGeneration}
      />

      <div
        ref={historyTriggerRef}
        style={{ position: "absolute", top: 56, right: 120, width: 1, height: 1, pointerEvents: "none" }}
      />

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {tab === "dashboard" ? (
          <DashboardBody
            briefing={briefing}
            liveData={liveData}
            calendarRange={calendarRange}
            customize={customize}
            accent={accent}
            isMobile={isMobile}
            viewingPast={bd.viewingPast}
            onOpenEmail={openEmailInInbox}
            onOpenDeadline={(task, anchor) => {
              if (!isMobile) {
                openCalendar("deadlines", task?.due_date || null, task?.id || null);
                return;
              }
              setDeadlinePopover((prev) => {
                if (prev && String(prev.task?.id) === String(task?.id)) return null;
                return { task, anchor };
              });
            }}
            onOpenBillsCalendar={(date) => openCalendar("bills", date || null)}
            onOpenEventsCalendar={(date) => openCalendar("events", date || null)}
            onOpenDeadlinesCalendar={(date) => openCalendar("deadlines", date || null)}
            onJumpSection={jumpToSection}
          />
        ) : (
          <InboxView
            accent={accent}
            customize={customize}
            emailAccounts={briefing?.emails?.accounts || []}
            briefingSummary={briefing?.emails?.summary}
            briefingGeneratedAt={liveData.briefingGeneratedAt}
            liveEmails={liveData.liveEmails}
            liveReadOverrides={liveReadOverrides}
            onLiveReadOverrideChange={handleLiveReadOverrideChange}
            pinnedIds={liveData.pinnedIds}
            pinnedSnapshots={liveData.pinnedSnapshots}
            snoozedEntries={liveData.snoozedEntries}
            resurfacedEntries={liveData.resurfacedEntries}
            onOpenDashboard={() => setShellTab("dashboard")}
            onRefresh={onQuickRefresh}
            seedSelectedId={inboxSeedId}
            isMobile={isMobile}
          />
        )}
      </div>

      {isMobile && deadlinePopover && (
        <DeadlineDetailPopover
          task={deadlinePopover.task}
          anchor={deadlinePopover.anchor}
          accent={accent}
          onClose={() => setDeadlinePopover(null)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        accent={accent}
        onClose={() => setPaletteOpen(false)}
        onAction={handlePaletteAction}
      />

      <CustomizePanel
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        customize={customize}
        tab={tab}
        isMobile={isMobile}
      />

      {historyOpen && (
        <BriefingHistoryPanel
          activeId={bd.viewingPast?.id ?? bd.latestId}
          triggerRef={historyTriggerRef}
          onSelect={(briefingData, meta) => { bd.selectHistory(briefingData, meta); setHistoryOpen(false); }}
          onClose={() => setHistoryOpen(false)}
          onDelete={deleteBriefing}
        />
      )}

      {!isMobile && (
        <CalendarModal
          open={calendarOpen}
          onClose={dismissCalendar}
          view={calendarView}
          onViewChange={changeCalendarView}
          focusDate={calendarFocus}
          focusItemId={calendarFocusItemId}
          eventsData={eventsData}
          billsData={{
            schedules: liveData.allSchedules,
            recentTransactions: liveData.recentTransactions,
            payeeMap: liveData.payeeMap,
            actualBudgetUrl: liveData.actualBudgetUrl,
          }}
          deadlinesData={{
            ctm: calendarDeadlines?.ctm || briefing?.ctm,
            todoist: calendarDeadlines?.todoist || briefing?.todoist,
          }}
        />
      )}
    </div>
  );
}

/* ======================================================================
 * DASHBOARD BODY — hero + timeline + rails (layout variants)
 * ====================================================================== */
const dashboardSectionTransition = {
  type: "spring",
  stiffness: 290,
  damping: 32,
  mass: 0.98,
  bounce: 0,
};

const dashboardFadeTransition = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1],
};

const dashboardStageDelays = {
  hero: 0.02,
  primary: 0.06,
  secondary: 0.1,
  tertiary: 0.14,
};

function DashboardLayoutFrame({ layoutMode, maxWidth, style, children, testId }) {
  return (
    <Motion.div
      key={layoutMode}
      data-testid={testId}
      data-layout-mode={layoutMode}
      initial={{ opacity: 0, y: 14, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
        y: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
        scale: { ...dashboardFadeTransition, delay: dashboardStageDelays.hero },
      }}
      style={{ maxWidth, margin: "0 auto", ...style }}
    >
      {children}
    </Motion.div>
  );
}

function DashboardSceneRegion({
  children,
  delay = 0,
  initial = { opacity: 0, y: 12, scale: 0.996 },
  style,
}) {
  return (
    <Motion.div
      layout
      initial={initial}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{
        layout: dashboardSectionTransition,
        opacity: { ...dashboardFadeTransition, delay },
        y: { ...dashboardFadeTransition, delay },
        x: { ...dashboardFadeTransition, delay },
        scale: { ...dashboardFadeTransition, delay },
      }}
      style={style}
    >
      {children}
    </Motion.div>
  );
}

export function DashboardBody({
  briefing, liveData, calendarRange, customize, accent,
  isMobile = false,
  onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar, onOpenDeadlinesCalendar, onJumpSection,
}) {
  const { dashboardLayout, density, showInsights, showInboxPeek, showNotes } = customize;
  const effectiveLayout = isMobile ? "paper" : dashboardLayout;
  const ctx = useDashboard();

  const seededEvents = useMemo(() => briefing?.calendar || [], [briefing?.calendar]);
  const [events, setEvents] = useState([]);
  const [liveEventsReady, setLiveEventsReady] = useState(false);
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()),
    [],
  );
  const ensureCalendarRange = calendarRange.ensureRange;
  const calendarRevision = calendarRange.revision;

  useEffect(() => {
    const endDate = new Date(`${today}T12:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 14);
    const end = endDate.toISOString().slice(0, 10);
    let cancelled = false;
    ensureCalendarRange(today, end)
      .then((result) => {
        if (!cancelled) {
          setEvents(result);
          setLiveEventsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents((prev) => (prev.length > 0 ? prev : seededEvents));
          setLiveEventsReady(true);
        }
      });
    return () => { cancelled = true; };
  }, [ensureCalendarRange, today, seededEvents, calendarRevision]);
  const ctm = useMemo(() => briefing?.ctm?.upcoming || [], [briefing?.ctm?.upcoming]);
  const todoist = useMemo(() => briefing?.todoist?.upcoming || [], [briefing?.todoist?.upcoming]);
  const deadlines = useMemo(() => [...ctm, ...todoist], [ctm, todoist]);
  const bills = liveData.liveBills || [];
  const insights = briefing?.aiInsights || [];
  const emailAccounts = ctx.emailAccounts;
  const pressureNow = useMemo(() => new Date(`${today}T12:00:00Z`).getTime(), [today]);
  const displayEvents = liveEventsReady ? events : seededEvents;
  const eventLoadingState = liveEventsReady
    ? "ready"
    : seededEvents.length > 0
      ? "refreshing"
      : "empty_loading";
  const billsLoadingState = liveData.isPolling && liveData.actualConfigured && liveData.billsLoading && !bills.length
    ? "empty_loading"
    : "ready";
  const pressureFocusDate = useMemo(
    () => focusPressureDate(deadlines, pressureNow),
    [deadlines, pressureNow],
  );

  const handleRailJump = useCallback((payload, anchor) => {
    if (!payload) return;
    if (payload.kind === "email" && payload.email?.id) {
      onOpenEmail(payload.email.id);
    } else if (payload.kind === "deadline") {
      onOpenDeadline(payload.data || payload, anchor);
    } else if (payload.kind === "bill") {
      onOpenBillsCalendar(payload.data?.next_date || payload.date || null);
    } else if (payload.kind === "event" && payload.data?.startMs) {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
      }).format(new Date(payload.data.startMs));
      onOpenEventsCalendar(ymd);
    }
  }, [onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar]);

  const hero = (
    <DashboardHero
      accent={accent}
      density={density}
      isMobile={isMobile}
      stack={isMobile}
      briefing={briefing}
      liveWeather={liveData.liveWeather}
      liveCalendar={displayEvents}
      liveBills={bills}
      onOpenPressure={() => onOpenDeadlinesCalendar?.(pressureFocusDate)}
      eventLoadingState={eventLoadingState}
      onJump={(payload, anchor) => {
        if (payload?.kind === "deadline") {
          // Callout carries { title, sub, ... } but not the full task — find it.
          const task = deadlines.find((d) => d.title === payload.title);
          if (task) onOpenDeadline(task, anchor);
        } else if (payload?.kind === "bill") {
          const match = bills.find((b) => b.name === payload.title);
          onOpenBillsCalendar(match?.next_date || payload.date || null);
        } else {
          onJumpSection("timeline");
        }
      }}
    />
  );

  const timeline = (
    <TodayTimeline
      accent={accent}
      density={density}
      isMobile={isMobile}
      events={displayEvents}
      deadlines={deadlines}
      onJump={handleRailJump}
      eventLoadingState={eventLoadingState}
    />
  );

  const rails = (
    <>
      {showInsights && (
        <InsightsRail accent={accent} insights={insights} onJump={handleRailJump} />
      )}
      <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} isMobile={isMobile} />
      <BillsRail
        accent={accent}
        bills={bills}
        onJump={handleRailJump}
        isMobile={isMobile}
        loadingState={billsLoadingState}
      />
      {showInboxPeek && (
        <InboxPeek
          accent={accent}
          isMobile={isMobile}
          emailAccounts={emailAccounts}
          onJump={handleRailJump}
          onOpenInbox={() => onOpenEmail(null)}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <DashboardLayoutFrame
        testId="dashboard-body-mobile"
        layoutMode={effectiveLayout}
        maxWidth={640}
        style={{ width: "100%", maxWidth: 640, margin: "0 auto", padding: "0 0 32px" }}
      >
        {hero}
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, y: 14, scale: 0.994 }}
          style={{ padding: "20px 16px 0", display: "flex", flexDirection: "column", gap: 24 }}
        >
          <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} isMobile />
          <BillsRail
            accent={accent}
            bills={bills}
            onJump={handleRailJump}
            isMobile
            loadingState={billsLoadingState}
          />
          {showInboxPeek && (
            <InboxPeek
              accent={accent}
              isMobile
              emailAccounts={emailAccounts}
              onJump={handleRailJump}
              onOpenInbox={() => onOpenEmail(null)}
            />
          )}
          {showInsights && (
            <InsightsRail
              accent={accent}
              insights={insights}
              onJump={handleRailJump}
              isMobile
              maxItems={2}
            />
          )}
        </DashboardSceneRegion>
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "20px 16px 0" }} />
        {timeline}
      </DashboardLayoutFrame>
    );
  }

  if (effectiveLayout === "paper") {
    return (
      <DashboardLayoutFrame layoutMode={effectiveLayout} maxWidth={820} style={{ padding: "0 20px 80px" }}>
        {hero}
        {timeline}
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 36px" }} />
        <DashboardSceneRegion
          delay={dashboardStageDelays.secondary}
          initial={{ opacity: 0, y: 16, scale: 0.994 }}
          style={{ padding: "28px 36px", display: "flex", flexDirection: "column", gap: 36 }}
        >
          {rails}
        </DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }

  if (effectiveLayout === "command") {
    return (
      <DashboardLayoutFrame layoutMode={effectiveLayout} maxWidth={1520}>
        {hero}
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, y: 16, scale: 0.994 }}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 300px",
            gap: 0, borderTop: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          <DashboardSceneRegion
            delay={dashboardStageDelays.primary}
            initial={{ opacity: 0, x: -18, y: 8, scale: 0.996 }}
            style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}
          >
            {timeline}
          </DashboardSceneRegion>
          <DashboardSceneRegion
            delay={dashboardStageDelays.secondary}
            initial={{ opacity: 0, y: 12, scale: 0.996 }}
            style={{
              padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28,
              borderRight: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {showInsights && <InsightsRail accent={accent} insights={insights} onJump={handleRailJump} />}
            <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} />
            {showNotes && <NotesRail accent={accent} />}
          </DashboardSceneRegion>
          <DashboardSceneRegion
            delay={dashboardStageDelays.tertiary}
            initial={{ opacity: 0, x: 18, y: 8, scale: 0.996 }}
            style={{ padding: "24px 22px", display: "flex", flexDirection: "column", gap: 28 }}
          >
            <BillsRail
              accent={accent}
              bills={bills}
              onJump={handleRailJump}
              loadingState={billsLoadingState}
            />
            {showInboxPeek && (
              <InboxPeek
                accent={accent}
                emailAccounts={emailAccounts}
                onJump={handleRailJump}
                onOpenInbox={() => onOpenEmail(null)}
              />
            )}
          </DashboardSceneRegion>
        </DashboardSceneRegion>
      </DashboardLayoutFrame>
    );
  }

  // focus (default)
  return (
    <DashboardLayoutFrame layoutMode={effectiveLayout} maxWidth={1440}>
      {hero}
      <DashboardSceneRegion
        delay={dashboardStageDelays.primary}
        initial={{ opacity: 0, y: 16, scale: 0.994 }}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 0,
          borderTop: "1px solid rgba(255,255,255,0.03)",
        }}
      >
        <DashboardSceneRegion
          delay={dashboardStageDelays.primary}
          initial={{ opacity: 0, x: -12, y: 8, scale: 0.996 }}
        >
          {timeline}
        </DashboardSceneRegion>
        <DashboardSceneRegion
          delay={dashboardStageDelays.secondary}
          initial={{ opacity: 0, x: 14, y: 10, scale: 0.996 }}
          style={{
            borderLeft: "1px solid rgba(255,255,255,0.05)",
            padding: "24px 28px",
            display: "flex", flexDirection: "column", gap: 28,
          }}
        >
          {rails}
        </DashboardSceneRegion>
      </DashboardSceneRegion>
    </DashboardLayoutFrame>
  );
}

function formatNextBriefingLabel(schedules) {
  if (!Array.isArray(schedules) || schedules.length === 0) return null;
  const now = new Date();
  const upcoming = schedules
    .filter((s) => s.enabled !== false && s.hour != null)
    .map((s) => {
      const next = new Date(now);
      next.setHours(s.hour, s.minute ?? 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return { s, ms: next.getTime() };
    })
    .sort((a, b) => a.ms - b.ms);
  if (upcoming.length === 0) return null;
  const diffMs = upcoming[0].ms - now.getTime();
  const h = Math.floor(diffMs / 3600000);
  const m = Math.round((diffMs % 3600000) / 60000);
  const label = h <= 0 ? `${m}m` : `${h}h ${m}m`;
  return `Next briefing · ${label}`;
}
