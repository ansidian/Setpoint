import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
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
  resolveCalendarOpenState,
  resolveDashboardShellHotkey,
} from "./dashboardShellModel.js";
export { DashboardBody };
const InboxView = lazy(() => import("../inbox/InboxView"));

export function RedesignShell({
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
    handleDismissGhost,
    handleUpdateTaskStatus,
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
  const [inboxSession, setInboxSession] = useState({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: null,
  });

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
  const actionChordRef = useRef(null);
  const actionChordTimerRef = useRef(null);
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
    refreshKey: liveData.briefingGeneratedAt,
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
  const openCalendar = (viewKey, focusDate = null, focusItemId = null, options = {}) => {
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
  };
  const openTodoistCreate = useCallback(() => {
    if (isMobile) {
      setAddTaskOpen(true);
      return;
    }
    openCalendar("events", null, "new", { source: "dashboard", forceDeadlineOverlay: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  const changeCalendarView = (v) => {
    setCalendarView(v);
    try { localStorage.setItem("calendar:lastView", v); } catch { /* ignore */ }
    if (v === "deadlines") loadCalendarDeadlines();
    if (v === "bills") loadCalendarBills({ refreshLive: true });
  };

  useEffect(() => {
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

  useEffect(() => () => {
    if (actionChordTimerRef.current) clearTimeout(actionChordTimerRef.current);
  }, []);

  // Global hotkeys: ⌘K palette, a analytics, c calendar, y snapshots, g+key action chords
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
      const editableTarget = (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
        || target.closest?.("[data-suspend-calendar-hotkeys='true']")
      );
      const command = resolveDashboardShellHotkey({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        repeat: e.repeat,
        editableTarget,
        actionChord: actionChordRef.current,
        calendarOpen,
      });

      if (command.action === "clear-chord") {
        clearActionChord();
        return;
      }
      if (command.action === "open-palette") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (command.clearChord) {
        clearActionChord();
      }
      if (command.action === "open-todoist-create") {
        e.preventDefault();
        openTodoistCreate();
        return;
      }
      if (command.action === "open-event-create") {
        e.preventDefault();
        openCalendar("events", null, "new");
        return;
      }
      if (command.action === "start-g-chord") {
        actionChordRef.current = "g";
        actionChordTimerRef.current = setTimeout(clearActionChord, 900);
        e.preventDefault();
        return;
      }
      if (command.action === "toggle-analytics") {
        e.preventDefault();
        if (analyticsOpen) closeAnalytics();
        else void openAnalytics();
        return;
      }
      if (command.action === "open-calendar") { openCalendar(); }
      if (command.action === "toggle-history") { setHistoryOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsOpen, calendarOpen, closeAnalytics, isMobile, openAnalytics, openPalette, openTodoistCreate]);

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
    setInboxSession((prev) => ({
      ...prev,
      accountId: "__all",
      lane: "__all",
      search: "",
      selectedId: null,
      inboxAiSearch: null,
    }));
    setShellTab("inbox");
    setHistoryOpen(false);
  }, [setHistoryOpen, setShellTab]);

  // Deadline detail popover (anchored to the clicked row)
  const [deadlinePopover, setDeadlinePopover] = useState(null);

  const handlePaletteAction = useCallback((item) => {
    if (item.kind === "tab") setShellTab(item.payload);
    else if (item.kind === "scroll") jumpToSection(item.payload);
    else if (item.kind === "calendar") openCalendar();
    else if (item.kind === "todoist") openTodoistCreate();
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
    else if (item.kind === "settings") window.location.href = "/settings";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePalette, jumpToSection, onQuickRefresh, openAnalytics, openTodoistCreate, setShellTab]);

  const eventsData = useMemo(() => buildDashboardEventsData(calendarRange), [calendarRange]);

  useEffect(() => {
    const activeUids = collectActiveReadOverrideKeys({
      activeSnapshotView: activeSnapshot?.snapshot,
      liveEmails: liveData.liveEmails,
      resurfacedEntries: liveData.resurfacedEntries,
    });
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
    onUpdateTaskStatus: (...args) => {
      const result = handleUpdateTaskStatus(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
    onDeleteTask: (...args) => {
      const result = handleDeleteTask(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
    onDismissGhost: (...args) => {
      const result = handleDismissGhost(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
  }), [
    handleCompleteTask,
    handleDeleteTask,
    handleDismissGhost,
    handleUpdateTaskStatus,
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
        analyticsOpen={analyticsOpen}
        onOpenAnalytics={() => { void openAnalytics(); }}
        onPrepareAnalytics={prepareBackdropSnapshot}
        onOpenPalette={openPalette}
        onOpenCustomize={() => setCustomizeOpen((v) => !v)}
        onOpenHistory={() => setHistoryOpen((v) => !v)}
        onOpenCalendar={() => openCalendar()}
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
                openCalendar("events", task?.due_date || null, task?.id || null, {
                  source: "dashboard",
                  openDetail: !!task?.id,
                  forceDeadlineOverlay: true,
                  forceCompletedDeadlineOverlay: !!task?.id,
                });
                return;
              }
              setDeadlinePopover((prev) => {
                if (prev && String(prev.task?.id) === String(task?.id)) return null;
                return { task, anchor };
              });
            }}
            onOpenBillsCalendar={(date, itemId) => openCalendar("bills", date || null, itemId || null, {
              source: "dashboard",
              openDetail: !!itemId,
            })}
            onOpenEventsCalendar={(date, itemId) => openCalendar("events", date || null, itemId, {
              source: "dashboard",
              openDetail: !!itemId && itemId !== "new",
              forceEventOverlay: !!itemId && itemId !== "new",
            })}
            onOpenDeadlinesCalendar={(date, itemId) => openCalendar("events", date || null, itemId || null, {
              source: "dashboard",
              openDetail: !!itemId,
              forceDeadlineOverlay: true,
              forceCompletedDeadlineOverlay: !!itemId,
            })}
            onOpenTodoistCreate={openTodoistCreate}
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
              sessionState={inboxSession}
              onSessionStateChange={setInboxSession}
              commitPendingUndoSignal={calendarOpenRequestId}
              isMobile={isMobile}
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
    </div>
  );
}
