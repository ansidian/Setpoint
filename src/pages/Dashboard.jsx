import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
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
import AddTaskPanel from "../components/todoist/AddTaskPanel";
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
import { reconcileBriefingReadStatus } from "../lib/briefing-email-state";
import { mergeReadState } from "../components/inbox/helpers";
import EmptyStateSplash from "../components/shared/EmptyStateSplash";
import {
  DashboardBodyLayout,
  DashboardSurface,
} from "../components/dashboard/layout/DashboardScenePrimitives";

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
    bd.setBriefing((prev) => reconcileBriefingReadStatus(prev, status));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bd.setBriefing is stable
  }, [liveData.briefingReadStatus]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef(null);

  const [calendarDeadlines, setCalendarDeadlines] = useState(null);
  const [calendarDeadlinesLoading, setCalendarDeadlinesLoading] = useState(false);
  const calendarDeadlinesLoadingRef = useRef(false);
  const loadCalendarDeadlines = (opts) => {
    if (calendarDeadlinesLoadingRef.current && !opts?.force) return;
    calendarDeadlinesLoadingRef.current = true;
    setCalendarDeadlinesLoading(true);
    getCalendarDeadlines()
      .then((data) => setCalendarDeadlines(data))
      .catch((err) => console.error("Calendar deadlines fetch failed:", err))
      .finally(() => {
        calendarDeadlinesLoadingRef.current = false;
        setCalendarDeadlinesLoading(false);
      });
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
        calendarDeadlinesLoading={calendarDeadlinesLoading}
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
  calendarDeadlines, calendarDeadlinesLoading, loadCalendarDeadlines,
}) {
  const customize = useCustomize();
  const isMobile = useIsMobile();
  const { handleAddTask } = useDashboard();
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
  const [inboxSession, setInboxSession] = useState({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: null,
  });

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarOpenRequestId, setCalendarOpenRequestId] = useState(0);
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
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const actionChordRef = useRef(null);
  const actionChordTimerRef = useRef(null);
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
    setCalendarOpenRequestId((value) => value + 1);
    setCalendarOpen(true);
    if (resolved === "deadlines") loadCalendarDeadlines();
  };
  const openTodoistCreate = useCallback(() => {
    if (isMobile) {
      setAddTaskOpen(true);
      return;
    }
    openCalendar("deadlines", null, "new");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  const changeCalendarView = (v) => {
    setCalendarView(v);
    try { localStorage.setItem("calendar:lastView", v); } catch { /* ignore */ }
    if (v === "deadlines") loadCalendarDeadlines();
  };

  useEffect(() => {
    if (isMobile && calendarOpen) setCalendarOpen(false);
  }, [isMobile, calendarOpen]);

  useEffect(() => () => {
    if (actionChordTimerRef.current) clearTimeout(actionChordTimerRef.current);
  }, []);

  // Global hotkeys: ⌘K palette, c calendar, g+key action chords
  useEffect(() => {
    const clearActionChord = () => {
      actionChordRef.current = null;
      if (actionChordTimerRef.current) {
        clearTimeout(actionChordTimerRef.current);
        actionChordTimerRef.current = null;
      }
    };

    function onKey(e) {
      const target = e.target;
      if (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
        || target.closest?.("[data-suspend-calendar-hotkeys='true']")
      ) {
        clearActionChord();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();

      if (actionChordRef.current === "g") {
        clearActionChord();
        if (key === "t") {
          e.preventDefault();
          openTodoistCreate();
          return;
        }
        if (key === "e" || key === "c") {
          e.preventDefault();
          openCalendar("events", null, "new");
          return;
        }
      }

      if (key === "g") {
        actionChordRef.current = "g";
        actionChordTimerRef.current = setTimeout(clearActionChord, 900);
        e.preventDefault();
        return;
      }

      if (key === "c" && !calendarOpen) { openCalendar(); }
      if (key === "h") { setHistoryOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarOpen, isMobile, openTodoistCreate]);

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
  const openEmailInInbox = useCallback((id) => {
    if (id) {
      setInboxSession((prev) => ({
        ...prev,
        selectedId: id,
      }));
    }
    setShellTab("inbox");
  }, [setShellTab]);

  // Deadline detail popover (anchored to the clicked row)
  const [deadlinePopover, setDeadlinePopover] = useState(null);

  const handlePaletteAction = useCallback((item) => {
    if (item.kind === "tab") setShellTab(item.payload);
    else if (item.kind === "scroll") jumpToSection(item.payload);
    else if (item.kind === "calendar") openCalendar();
    else if (item.kind === "todoist") openTodoistCreate();
    else if (item.kind === "event") openCalendar("events", null, "new");
    else if (item.kind === "history") setHistoryOpen(true);
    else if (item.kind === "customize") setCustomizeOpen(true);
    else if (item.kind === "refresh") onQuickRefresh?.();
    else if (item.kind === "regenerate") handleFullGeneration();
    else if (item.kind === "settings") window.location.href = "/settings";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToSection, onQuickRefresh, handleFullGeneration, openTodoistCreate, setShellTab]);

  const eventsData = useMemo(() => ({
    ensureRange: calendarRange.ensureRange,
    refreshRange: calendarRange.refreshRange,
    upsertEvents: calendarRange.upsertEvents,
    removeEvent: calendarRange.removeEvent,
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
    calendarRange.upsertEvents,
    calendarRange.removeEvent,
    calendarRange.getEvents,
    calendarRange.hasMonth,
    calendarRange.isMonthLoading,
    calendarRange.loading,
    calendarRange.error,
    calendarRange.revision,
    isMock,
  ]);

  const [briefingStatusNow, setBriefingStatusNow] = useState(() => Date.now());
  const [briefingNoticeUntil, setBriefingNoticeUntil] = useState(0);
  const statusInitRef = useRef(false);
  const prevLatestIdRef = useRef(bd.latestId);
  const prevRefreshAtRef = useRef(bd.lastQuickRefreshAt);

  useEffect(() => {
    const id = setInterval(() => setBriefingStatusNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!statusInitRef.current) {
      statusInitRef.current = true;
      prevLatestIdRef.current = bd.latestId;
      prevRefreshAtRef.current = bd.lastQuickRefreshAt;
      return;
    }

    const latestChanged = bd.latestId && prevLatestIdRef.current && prevLatestIdRef.current !== bd.latestId;
    const quickRefreshChanged = bd.lastQuickRefreshAt && prevRefreshAtRef.current !== bd.lastQuickRefreshAt;
    if (latestChanged || quickRefreshChanged) {
      setBriefingNoticeUntil(Date.now() + 60_000);
    }
    prevLatestIdRef.current = bd.latestId;
    prevRefreshAtRef.current = bd.lastQuickRefreshAt;
  }, [bd.latestId, bd.lastQuickRefreshAt]);

  const nextBriefing = useMemo(
    () => getNextBriefingSchedule(bd.schedules, briefingStatusNow),
    [bd.schedules, briefingStatusNow],
  );
  const briefingStatus = useMemo(
    () => buildBriefingStatus({
      briefing,
      nextBriefing,
      nowMs: briefingStatusNow,
      noticeActive: briefingNoticeUntil > briefingStatusNow,
    }),
    [briefing, nextBriefing, briefingNoticeUntil, briefingStatusNow],
  );

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
        background: [
          `radial-gradient(circle at top, ${accent}08 0%, transparent 24%)`,
          "linear-gradient(180deg, #0b0c12 0%, #0a0b10 100%)",
        ].join(", "),
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
        briefingStatus={briefingStatus}
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

      <div
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 12%)",
        }}
      >
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
            onOpenEventsCalendar={(date, itemId) => openCalendar("events", date || null, itemId)}
            onOpenDeadlinesCalendar={(date) => openCalendar("deadlines", date || null)}
            onOpenTodoistCreate={openTodoistCreate}
            onJumpSection={jumpToSection}
            setAddTaskOpen={setAddTaskOpen}
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
            sessionState={inboxSession}
            onSessionStateChange={setInboxSession}
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

      {isMobile && addTaskOpen && (
        <AddTaskPanel
          host="anchored"
          onClose={() => setAddTaskOpen(false)}
          onTaskAdded={(task) => {
            handleAddTask(task);
            setAddTaskOpen(false);
          }}
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
          openRequestId={calendarOpenRequestId}
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
            ctm: calendarDeadlines?.ctm || { upcoming: [], stats: null },
            todoist: calendarDeadlines?.todoist || { upcoming: [], stats: null },
            isLoading: calendarDeadlinesLoading && !calendarDeadlines,
          }}
        />
      )}
    </div>
  );
}

export function DashboardBody({
  briefing, liveData, calendarRange, customize, accent,
  isMobile = false,
  onOpenEmail, onOpenDeadline, onOpenBillsCalendar, onOpenEventsCalendar, onOpenDeadlinesCalendar, onOpenTodoistCreate, onJumpSection, setAddTaskOpen,
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
  const billsLoadingState = liveData.actualConfigured && liveData.billsLoading && !bills.length
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
      onQuickAction={(action) => {
        if (action === "task") {
          if (onOpenTodoistCreate) onOpenTodoistCreate();
          else setAddTaskOpen?.(true);
        } else if (action === "event") {
          onOpenEventsCalendar(today, "new");
        }
      }}
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

  const timelinePanel = (
    <DashboardSurface isMobile={isMobile} style={{ minHeight: 520 }}>
      {timeline}
    </DashboardSurface>
  );

  const insightsSection = showInsights ? (
    <InsightsRail
      accent={accent}
      insights={insights}
      onJump={handleRailJump}
      isMobile={isMobile}
      maxItems={isMobile ? 2 : 5}
    />
  ) : null;

  const deadlinesSection = <DeadlinesRail accent={accent} deadlines={deadlines} onJump={handleRailJump} isMobile={isMobile} />;

  const billsSection = (
    <BillsRail
      accent={accent}
      bills={bills}
      onJump={handleRailJump}
      isMobile={isMobile}
      loadingState={billsLoadingState}
    />
  );

  const inboxSection = showInboxPeek ? (
    <InboxPeek
      accent={accent}
      isMobile={isMobile}
      emailAccounts={emailAccounts}
      onJump={handleRailJump}
      onOpenInbox={() => onOpenEmail(null)}
    />
  ) : null;

  const notesSection = showNotes ? <NotesRail accent={accent} /> : null;

  return (
    <DashboardBodyLayout
      layoutMode={effectiveLayout}
      isMobile={isMobile}
      hero={hero}
      timelinePanel={timelinePanel}
      mobileSections={[deadlinesSection, billsSection, inboxSection, insightsSection]}
      primaryRailSections={[insightsSection, deadlinesSection, billsSection, inboxSection]}
      commandPrimaryRailSections={[insightsSection, deadlinesSection, notesSection]}
      commandSecondaryRailSections={[billsSection, inboxSection]}
    />
  );
}

function parseScheduleClock(schedule) {
  if (typeof schedule?.time === "string" && /^\d{2}:\d{2}$/.test(schedule.time)) {
    const [hour, minute] = schedule.time.split(":").map(Number);
    return { hour, minute };
  }
  if (schedule?.hour != null) {
    return { hour: Number(schedule.hour), minute: Number(schedule.minute ?? 0) };
  }
  return null;
}

function formatRelativeWindow(targetMs, nowMs) {
  const diffMs = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `in ${minutes}m`;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

function formatClockTime(date, timeZone = "America/Los_Angeles") {
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function getNextBriefingSchedule(schedules, nowMs = Date.now()) {
  if (!Array.isArray(schedules) || schedules.length === 0) return null;
  const now = new Date(nowMs);
  const upcoming = schedules
    .filter((schedule) => schedule?.enabled !== false)
    .map((schedule) => {
      const clock = parseScheduleClock(schedule);
      if (!clock) return null;
      const next = new Date(now);
      next.setHours(clock.hour, clock.minute, 0, 0);
      if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
      return {
        schedule,
        nextMs: next.getTime(),
        label: schedule.label || "Scheduled briefing",
        timeLabel: formatClockTime(next, schedule.tz || "America/Los_Angeles"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nextMs - b.nextMs);

  if (!upcoming.length) return null;
  const next = upcoming[0];
  return {
    ...next,
    relativeLabel: formatRelativeWindow(next.nextMs, nowMs),
  };
}

function formatAgoLabel(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const dt = new Date(iso);
  const diffMs = Math.max(0, nowMs - dt.getTime());
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildBriefingStatus({ briefing, nextBriefing, nowMs, noticeActive }) {
  if (!briefing) return nextBriefing ? {
    label: "Schedule",
    headline: `${nextBriefing.label} ${nextBriefing.relativeLabel}`,
    detail: `${nextBriefing.timeLabel}`,
    sourceLabel: "Scheduled",
    ageLabel: nextBriefing.relativeLabel,
    nextLabel: `Next ${nextBriefing.timeLabel}`,
    nextDetail: nextBriefing.label,
    toneColor: "#89b4fa",
  } : null;

  const dataUpdatedAt = briefing.dataUpdatedAt || briefing.aiGeneratedAt || null;
  const updatedLabel = formatAgoLabel(dataUpdatedAt, nowMs);
  const aiLabel = formatAgoLabel(briefing.aiGeneratedAt, nowMs);
  const quietRefreshes = briefing.skippedAI ? Math.max(1, briefing.nonAiGenerationCount || 1) : 0;
  const dataUpdatedMs = dataUpdatedAt ? new Date(dataUpdatedAt).getTime() : Number.NaN;
  const showRecentUpdate = Number.isFinite(dataUpdatedMs) && nowMs - dataUpdatedMs < 60_000;
  const showUpdateBadge = !!updatedLabel && (noticeActive || showRecentUpdate);
  const activityLabel = showUpdateBadge ? `Updated ${updatedLabel}` : null;
  const activityShortLabel = showUpdateBadge ? "Updated" : null;
  const activityToneColor = "#a6e3a1";

  const nextLine = nextBriefing
    ? `Next ${nextBriefing.label} at ${nextBriefing.timeLabel} (${nextBriefing.relativeLabel})`
    : "No schedules enabled";

  if (briefing.skippedAI) {
    const quietLabel = quietRefreshes > 1 ? `Quiet refresh · ${quietRefreshes} cloned updates` : "Quiet refresh";
    return {
      label: "Latest briefing",
      headline: aiLabel ? `${quietLabel} · Claude source ${aiLabel}` : quietLabel,
      detail: nextLine,
      sourceLabel: quietRefreshes > 1 ? `Quiet x${quietRefreshes}` : "Quiet",
      ageLabel: aiLabel,
      nextLabel: nextBriefing ? `Next ${nextBriefing.timeLabel}` : "No schedule",
      nextDetail: nextBriefing?.label || null,
      toneColor: "#89b4fa",
      activityLabel,
      activityShortLabel,
      activityToneColor,
    };
  }

  return {
    label: "Latest briefing",
    headline: aiLabel ? `Claude refreshed ${aiLabel}` : "Claude refreshed this briefing",
    detail: nextLine,
    sourceLabel: "Claude",
    ageLabel: aiLabel,
    nextLabel: nextBriefing ? `Next ${nextBriefing.timeLabel}` : "No schedule",
    nextDetail: nextBriefing?.label || null,
    toneColor: "#cba6da",
    activityLabel,
    activityShortLabel,
    activityToneColor,
  };
}
