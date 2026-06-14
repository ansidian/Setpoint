import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ShellHeader from "../shell/ShellHeader";
import { loadTriageAnalyticsModal } from "../shell/triageAnalyticsModalLoader.js";
import { useDashboard } from "../../context/DashboardContext";
import useCustomize from "../../hooks/useCustomize";
import useIsMobile from "../../hooks/useIsMobile";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { usePreparedBackdropSnapshot } from "../shell/usePreparedBackdropSnapshot.js";
import {
  collectActiveReadOverrideKeys,
  computeInboxUnreadSignalCount,
} from "./inboxBadgeModel.js";
import { DashboardBody } from "./DashboardBody";
import DashboardShellOverlays from "./DashboardShellOverlays.jsx";
import {
  buildDashboardEventsData,
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  resolveCalendarOpenState,
} from "./dashboardShellModel.js";
import useDashboardShellHotkeys from "./useDashboardShellHotkeys.js";
import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel.js";
import { resetInboxSession, setInboxSession } from "../inbox/useInboxSessionState";
export { DashboardBody };
const InboxView = lazy(() => import("../inbox/InboxView"));
const AlfredPanel = lazy(() => import("../alfred/AlfredPanel"));

export function DashboardShell({
  bd, liveData, calendarRange, activeSnapshot, onQuickRefresh,
  historyOpen, setHistoryOpen, historyTriggerRef, calendarDeadlines, calendarDeadlinesLoading,
  calendarDeadlinesError = false, loadCalendarDeadlines = () => {},
  calendarBillsData, calendarBillRange, calendarDeadlineRange, loadCalendarBills = () => {}, onCalendarWorkspaceChange,
}) {
  const customize = useCustomize();
  const isMobile = useIsMobile();
  const {
    handleAddTask,
    handleCompleteTask,
    handleDeleteTask,
  } = useDashboard();
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
  const [historicalSnapshotView, setHistoricalSnapshotView] = useState(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMounted, setCalendarMounted] = useState(false);
  const [calendarOpenRequestId, setCalendarOpenRequestId] = useState(0);
  const [calendarView, setCalendarView] = useState(() => {
    try {
      const saved = localStorage.getItem("calendar:lastView");
      if (saved === "bills" || saved === "events") return saved;
      return "events";
    } catch { return "events"; }
  });
  const showBills = !!liveData.actualConfigured;
  const [calendarFocus, setCalendarFocus] = useState(null);
  const [calendarFocusItemId, setCalendarFocusItemId] = useState(null);
  const [calendarFocusOpenDetail, setCalendarFocusOpenDetail] = useState(false);
  const [calendarForceOverlays, setCalendarForceOverlays] = useState({ events: false, deadlines: false, completedDeadlines: false });
  const calendarEventsRangeRef = useRef(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [alfredOpen, setAlfredOpen] = useState(false);
  const [alfredMounted, setAlfredMounted] = useState(false);
  const [alfredNewChatTick, setAlfredNewChatTick] = useState(0);
  const [alfredHandoff, setAlfredHandoff] = useState(null);
  const alfredHandoffSeq = useRef(0);
  const toggleAlfred = useCallback(() => {
    setAlfredMounted(true);
    setAlfredOpen((v) => !v);
  }, []);
  // Stable close handler so the memoized AlfredPanel's Esc-listener effect stops
  // re-binding on every dashboard SSE/refresh re-render of DashboardShell.
  const closeAlfred = useCallback(() => setAlfredOpen(false), []);
  const alfredNewChat = useCallback(() => {
    setAlfredMounted(true);
    setAlfredOpen(true);
    setAlfredNewChatTick((t) => t + 1);
  }, []);
  const askAlfred = useCallback((query) => {
    const q = String(query || "").trim();
    if (!q) return;
    setAlfredMounted(true);
    setAlfredOpen(true);
    alfredHandoffSeq.current += 1;
    setAlfredHandoff({ id: alfredHandoffSeq.current, query: q });
  }, []);
  const analyticsBackdropSourceRef = useRef(null);
  const {
    backdropSnapshot: shellBackdropSnapshot,
    prepareBackdropSnapshot,
    activateBackdropSnapshot,
    deactivateBackdropSnapshot,
  } = usePreparedBackdropSnapshot({
    sourceRef: analyticsBackdropSourceRef,
    loadSurface: loadTriageAnalyticsModal,
    refreshing: bd.refreshing,
    // refreshKey is intentionally left coarse (tab-only). Keying it on
    // liveData.lastFetched — which the server restamps on every /current — made the
    // SSE refetch and 5-min auto-refresh paths schedule a full-dashboard
    // html-to-image rasterization on every data tick (the `refreshing` gate in the
    // hook does not cover the SSE path). The backdrop re-prepares on
    // refreshing-settle + tab change, and openAnalytics/openPalette capture on
    // demand, so freshness is covered without per-tick rasterization.
    tab,
  });
  const closeAnalytics = useCallback(() => {
    setAnalyticsOpen(false);
    deactivateBackdropSnapshot({ delay: 500 });
  }, [deactivateBackdropSnapshot]);
  const openAnalytics = useCallback(() => {
    activateBackdropSnapshot({ captureIfStale: true });
    setAnalyticsOpen(true);
  }, [activateBackdropSnapshot]);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    deactivateBackdropSnapshot({ delay: 500 });
  }, [deactivateBackdropSnapshot]);
  const openPalette = useCallback(() => {
    activateBackdropSnapshot({ captureIfMissing: true, captureIfStale: true });
    setPaletteOpen(true);
  }, [activateBackdropSnapshot]);
  const dismissCalendar = useBrowserBackDismiss({
    enabled: !isMobile && calendarOpen,
    historyKey: "eaDashboardCalendarModal",
    onDismiss: () => setCalendarOpen(false),
  });
  // Memoized so the (memoized) AlfredPanel's onOpenCalendarItem can be stable and
  // bail out on unrelated dashboard re-renders. State setters are referentially
  // stable; deps are only the values openCalendar actually reads/calls.
  const openCalendar = useCallback((viewKey, focusDate = null, focusItemId = null, options = {}) => {
    const request = resolveCalendarOpenState({
      isMobile,
      viewKey,
      currentView: calendarView,
      showBills,
      focusDate,
      focusItemId,
      options,
    });
    if (!request) return;
    setCalendarView(request.view);
    try { localStorage.setItem("calendar:lastView", request.view); } catch { /* ignore */ }
    setCalendarFocus(request.focusDate);
    setCalendarFocusItemId(request.focusItemId);
    setCalendarFocusOpenDetail(request.focusOpenDetail);
    setCalendarForceOverlays({ events: request.forceEventOverlay, deadlines: request.forceDeadlineOverlay, completedDeadlines: request.forceCompletedDeadlineOverlay });
    setCalendarOpenRequestId((value) => value + 1);
    setCalendarMounted(true);
    setCalendarOpen(true);
    if (request.shouldLoadDeadlines) loadCalendarDeadlines();
    if (request.shouldLoadBills) loadCalendarBills({ refreshLive: true });
  }, [isMobile, calendarView, showBills, loadCalendarDeadlines, loadCalendarBills]);
  const openDeadlineCreate = useCallback(() => {
    if (isMobile) {
      setAddTaskOpen(true);
      return;
    }
    openCalendar("events", null, "new", { source: "dashboard", forceDeadlineOverlay: true });
  }, [isMobile, openCalendar]);
  // Stable handler for AlfredPanel chip deep-links — depends only on the now-stable
  // openCalendar, so the memoized panel can bail on unrelated parent re-renders.
  const handleAlfredOpenCalendarItem = useCallback((request) => {
    setAlfredOpen(false);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);

  // Stable ShellHeader callbacks so the memoized header (+ its chrome children)
  // stop re-rendering on every dashboard SSE/refresh re-render of DashboardShell.
  const handleHeaderOpenAnalytics = useCallback(() => { void openAnalytics(); }, [openAnalytics]);
  const handleHeaderToggleCustomize = useCallback(() => setCustomizeOpen((v) => !v), []);
  const handleHeaderToggleHistory = useCallback(() => setHistoryOpen((v) => !v), [setHistoryOpen]);
  const handleHeaderOpenCalendar = useCallback(() => openCalendar(), [openCalendar]);
  const changeCalendarView = (v) => {
    const nextView = normalizeCalendarWorkspaceView(v);
    setCalendarView(nextView);
    try { localStorage.setItem("calendar:lastView", nextView); } catch { /* ignore */ }
    if (nextView === "bills") loadCalendarBills({ refreshLive: true });
  };

  useEffect(() => {
    // Pre-existing: force-close the desktop calendar modal when the viewport
    // drops to mobile. setState-in-effect is intentional here (reacting to an
    // external viewport change), not derivable from render. (Surfaced by the
    // React-compiler lint once nearby callbacks were memoized — behavior unchanged.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isMobile && calendarOpen) setCalendarOpen(false);
  }, [isMobile, calendarOpen]);

  useEffect(() => {
    onCalendarWorkspaceChange?.({
      open: calendarOpen,
      view: calendarView,
      eventsRange: calendarEventsRangeRef.current,
    });
  }, [calendarOpen, calendarView, onCalendarWorkspaceChange]);

  const handleCalendarEventsRangeChange = useCallback((range) => {
    calendarEventsRangeRef.current = range;
    onCalendarWorkspaceChange?.({
      open: calendarOpen,
      view: calendarView,
      eventsRange: range,
    });
  }, [calendarOpen, calendarView, onCalendarWorkspaceChange]);

  // MERGE-NOTE[P3-26/P3-27] (P3 worktree): single signal for "a non-input overlay
  // owns the foreground", gating the global single-key shell hotkeys and ShellHeader's
  // 1/2 tab hotkeys so neither opens overlays behind, nor desyncs the tab from, the open
  // modal. Shares this file with a P2 fix on another worktree. On conflict: keep BOTH
  // unless the same lines collide (this only adds a derived const + two props). Remove
  // note after merge.
  const anyBlockingOverlayOpen = customizeOpen || analyticsOpen || historyOpen;

  useDashboardShellHotkeys({
    isMobile,
    calendarOpen,
    analyticsOpen,
    historyOpen,
    anyBlockingOverlayOpen,
    openPalette,
    openAnalytics,
    closeAnalytics,
    openDeadlineCreate,
    openCalendar,
    setHistoryOpen,
    toggleAlfred,
    alfredNewChat,
  });

  const { accent } = customize;
  const briefing = bd.briefing;
  const dashboardCalendarDeadlines = calendarDeadlines;

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
    setHistoricalSnapshotView(null);
    if (id) {
      setInboxSession((prev) => ({
        ...prev,
        selectedId: id,
      }));
    }
    setShellTab("inbox");
  }, [setShellTab]);



  const inboxActiveSnapshot = useMemo(() => {
    if (!historicalSnapshotView) return activeSnapshot;
    return {
      snapshot: historicalSnapshotView,
      loading: false,
      error: null,
      refresh: async () => {},
      sync: async () => {},
    };
  }, [activeSnapshot, historicalSnapshotView]);

  const handleSelectSnapshot = useCallback((snapshotView, meta) => {
    if (meta?.readOnly) {
      setHistoricalSnapshotView(snapshotView);
    } else {
      setHistoricalSnapshotView(null);
    }
    resetInboxSession();
    setShellTab("inbox");
    setHistoryOpen(false);
  }, [setHistoryOpen, setShellTab]);

  // Deadline detail popover (anchored to the clicked row)
  const [deadlinePopover, setDeadlinePopover] = useState(null);

  const navigate = useNavigate();
  const handlePaletteAction = useCallback((item) => {
    if (item.kind === "tab") setShellTab(item.payload);
    else if (item.kind === "scroll") jumpToSection(item.payload);
    else if (item.kind === "calendar") openCalendar();
    else if (item.kind === "deadline-create") openDeadlineCreate();
    else if (item.kind === "event") openCalendar("events", null, "new");
    else if (item.kind === "analytics") {
      closePalette();
      window.requestAnimationFrame(() => {
        void openAnalytics();
      });
    }
    else if (item.kind === "history") setHistoryOpen(true);
    else if (item.kind === "customize") setCustomizeOpen(true);
    else if (item.kind === "refresh") onQuickRefresh?.();
    // SPA navigation (honors the router basename, keeps SSE/caches alive) — the
    // old window.location.href forced a full reload and ignored a sub-path base.
    else if (item.kind === "settings") navigate("/settings");
  }, [closePalette, jumpToSection, navigate, onQuickRefresh, openAnalytics, openCalendar, openDeadlineCreate, setHistoryOpen, setShellTab]);

  const eventsData = useMemo(() => buildDashboardEventsData(calendarRange), [calendarRange]);

  useEffect(() => {
    const activeUids = collectActiveReadOverrideKeys({
      activeSnapshotView: activeSnapshot?.snapshot,
      liveEmails: liveData.liveEmails,
      resurfacedEntries: liveData.resurfacedEntries,
    });
    // Pre-existing: prune read-overrides whose emails left the active snapshot.
    // The functional setState only commits when something actually changed (it
    // returns prev otherwise), so no cascading render. (Surfaced by the
    // React-compiler lint once nearby callbacks were memoized — behavior unchanged.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveReadOverrides((prev) => {
      const next = {};
      let changed = false;
      for (const [uid, read] of Object.entries(prev)) {
        if (activeUids.has(uid)) next[uid] = read;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeSnapshot?.snapshot, liveData.liveEmails, liveData.resurfacedEntries]);

  const handleLiveReadOverrideChange = useCallback((uid, read) => {
    if (!uid) return;
    setLiveReadOverrides((prev) => {
      if (prev[uid] === read) return prev;
      return { ...prev, [uid]: !!read };
    });
  }, []);

  const inboxUnreadSignalCount = useMemo(() => {
    return computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot?.snapshot,
      liveEmails: liveData.liveEmails,
      resurfacedEntries: liveData.resurfacedEntries,
      liveReadOverrides,
    });
  }, [activeSnapshot?.snapshot, liveData.liveEmails, liveData.resurfacedEntries, liveReadOverrides]);

  const liveEmailsLoading = liveData.isPolling;
  const queueCalendarDeadlineRefresh = useCallback(() => {
    window.setTimeout(() => loadCalendarDeadlines({ force: true }), 900);
  }, [loadCalendarDeadlines]);
  const calendarDeadlineActions = useMemo(() => ({
    onCompleteTask: (...args) => {
      const result = handleCompleteTask(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
    onDeleteTask: (...args) => {
      const result = handleDeleteTask(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
  }), [
    handleCompleteTask,
    handleDeleteTask,
    queueCalendarDeadlineRefresh,
  ]);

  return (
    <div
      ref={analyticsBackdropSourceRef}
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
      <ShellHeader
        isMobile={isMobile}
        tab={tab}
        onTab={setShellTab}
        anyBlockingOverlayOpen={anyBlockingOverlayOpen}
        analyticsOpen={analyticsOpen}
        onOpenAnalytics={handleHeaderOpenAnalytics}
        onPrepareAnalytics={prepareBackdropSnapshot}
        onOpenPalette={openPalette}
        onOpenCustomize={handleHeaderToggleCustomize}
        onOpenHistory={handleHeaderToggleHistory}
        onOpenCalendar={handleHeaderOpenCalendar}
        inboxUnreadSignalCount={inboxUnreadSignalCount}
        refreshing={bd.refreshing}
        onQuickRefresh={onQuickRefresh}
        systemStatus={liveData.systemStatus}
      />

      <div
        ref={historyTriggerRef}
        style={{ position: "absolute", top: 56, right: 120, width: 1, height: 1, pointerEvents: "none" }}
      />

      <div
        style={{
          flex: 1,
          overflow: tab === "dashboard" && !isMobile ? "hidden" : "auto",
          minHeight: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 12%)",
        }}
      >
        {tab === "dashboard" ? (
          <DashboardBody
            briefing={briefing}
            liveData={liveData}
            activeSnapshot={activeSnapshot?.snapshot}
            calendarRange={calendarRange}
            customize={customize}
            accent={accent}
            isMobile={isMobile}
            calendarDeadlines={dashboardCalendarDeadlines}
            calendarDeadlinesLoading={calendarDeadlinesLoading}
            calendarDeadlinesError={!!calendarDeadlinesError}
            onOpenEmail={openEmailInInbox}
            onOpenDeadline={(task, anchor) => {
              if (!isMobile) {
                const request = dashboardDeadlineCalendarRequest(task);
                openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
                return;
              }
              setDeadlinePopover((prev) => {
                if (prev && String(prev.task?.id) === String(task?.id)) return null;
                return { task, anchor };
              });
            }}
            onOpenBillsCalendar={(date, itemId) => {
              const request = dashboardBillCalendarRequest(date, itemId);
              openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
            }}
            onOpenEventsCalendar={(date, itemId) => openCalendar("events", date || null, itemId, {
              source: "dashboard",
              openDetail: !!itemId && itemId !== "new",
              forceEventOverlay: !!itemId && itemId !== "new",
            })}
            onOpenDeadlinesCalendar={(date, itemId) => {
              const request = dashboardDeadlineCalendarRequest(itemId, date);
              openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
            }}
            onOpenDeadlineCreate={openDeadlineCreate}
            onJumpSection={jumpToSection}
            setAddTaskOpen={setAddTaskOpen}
          />
        ) : (
          <Suspense fallback={null}>
            <InboxView
              accent={accent}
              customize={customize}
              emailAccounts={[]}
              briefingSummary=""
              briefingGeneratedAt={liveData.briefingGeneratedAt}
              liveEmails={liveData.liveEmails}
              liveEmailsLoading={liveEmailsLoading}
              activeSnapshot={inboxActiveSnapshot}
              liveReadOverrides={liveReadOverrides}
              onLiveReadOverrideChange={handleLiveReadOverrideChange}
              snoozedEntries={liveData.snoozedEntries}
              resurfacedEntries={liveData.resurfacedEntries}
              onOpenDashboard={() => setShellTab("dashboard")}
              onRefresh={onQuickRefresh}
              commitPendingUndoSignal={calendarOpenRequestId}
              isMobile={isMobile}
              onAskAlfred={askAlfred}
            />
          </Suspense>
        )}
      </div>

      <DashboardShellOverlays
        isMobile={isMobile}
        deadlinePopover={deadlinePopover}
        setDeadlinePopover={setDeadlinePopover}
        accent={accent}
        addTaskOpen={addTaskOpen}
        setAddTaskOpen={setAddTaskOpen}
        handleAddTask={handleAddTask}
        queueCalendarDeadlineRefresh={queueCalendarDeadlineRefresh}
        paletteOpen={paletteOpen}
        shellBackdropSnapshot={shellBackdropSnapshot}
        closePalette={closePalette}
        handlePaletteAction={handlePaletteAction}
        analyticsOpen={analyticsOpen}
        closeAnalytics={closeAnalytics}
        customizeOpen={customizeOpen}
        setCustomizeOpen={setCustomizeOpen}
        customize={customize}
        tab={tab}
        historyOpen={historyOpen}
        historicalSnapshotView={historicalSnapshotView}
        activeSnapshot={activeSnapshot}
        historyTriggerRef={historyTriggerRef}
        handleSelectSnapshot={handleSelectSnapshot}
        setHistoryOpen={setHistoryOpen}
        calendarMountProps={{
          isMobile,
          calendarMounted,
          calendarOpen,
          calendarOpenRequestId,
          dismissCalendar,
          calendarView,
          changeCalendarView,
          calendarFocus,
          calendarFocusItemId,
          calendarFocusOpenDetail,
          calendarForceOverlays,
          eventsData,
          handleCalendarEventsRangeChange,
          liveData,
          briefing,
          calendarBillsData,
          calendarBillRange,
          calendarDeadlines,
          calendarDeadlinesLoading,
          calendarDeadlineRange,
          calendarDeadlineActions,
        }}
      />

      {alfredMounted && (
        <Suspense fallback={null}>
          <AlfredPanel
            open={alfredOpen}
            onClose={closeAlfred}
            accent={accent}
            handoff={alfredHandoff}
            newChatTick={alfredNewChatTick}
            onOpenCalendarItem={handleAlfredOpenCalendarItem}
          />
        </Suspense>
      )}
    </div>
  );
}
