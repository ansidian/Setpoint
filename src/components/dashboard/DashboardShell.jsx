import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import ShellHeader from "../shell/ShellHeader";
import { useDashboard } from "../../context/DashboardContext";
import useIsMobile from "../../hooks/useIsMobile";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import {
  collectActiveReadOverrideKeys,
  computeInboxUnreadSignalCount,
} from "./inboxBadgeModel.js";
import { DashboardBody } from "./DashboardBody";
import DashboardShellOverlays from "./DashboardShellOverlays.jsx";
import DashboardCalendarModalMount, { importCalendar } from "./DashboardCalendarModalMount.jsx";
import InboxMountFallback from "./InboxMountFallback.jsx";
import KeepAliveTab from "./KeepAliveTab.jsx";
import useWarmImport from "../../hooks/useWarmImport";
import {
  buildDashboardEventsData,
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  resolveCalendarOpenState,
} from "./dashboardShellModel.js";
import useDashboardShellHotkeys from "./useDashboardShellHotkeys.js";
import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel.js";
import { getInboxSession, resetInboxSession, setInboxSession, useInboxSelectedId } from "../inbox/useInboxSessionState";
export { DashboardBody };
// Single import factory so the inbox chunk can be both lazy-mounted and warmed
// in the background after the dashboard paints; the bundler dedupes to one fetch.
const importInboxView = () => import("../inbox/InboxView");
const InboxView = lazy(importInboxView);
const importNotesTab = () => import("../notes/NotesTab");
const NotesTab = lazy(importNotesTab);
const AlfredPanel = lazy(() => import("../alfred/AlfredPanel"));

// Former Customize defaults, now hardcoded. The accent + serif are also baked
// into src/index.css static fallbacks (--ea-accent / --serif-choice), so the
// runtime CSS-var injection the old customize hook did is no longer needed.
const SHELL_PREFS = Object.freeze({
  dashboardLayout: "focus",
  inboxLayout: "two-pane",
  inboxGrouping: "swimlanes",
  density: "comfortable",
  inboxDensity: "comfortable",
  aiVerbosity: "standard",
  accent: "#cba6da",
  serifChoice: "Instrument Serif",
  showInsights: true,
  showInboxPeek: true,
  showPreview: true,
});

export function DashboardShell({
  bd, liveData, calendarRange, activeSnapshot, onQuickRefresh,
  historyOpen, setHistoryOpen, historyTriggerRef, calendarDeadlines, calendarDeadlinesLoading,
  calendarDeadlinesError = false, loadCalendarDeadlines = () => {},
  calendarBillsData, calendarBillRange, calendarDeadlineRange, loadCalendarBills = () => {}, onCalendarWorkspaceChange,
}) {
  const isMobile = useIsMobile();
  const {
    handleAddTask,
    handleCompleteTask,
    handleDeleteTask,
  } = useDashboard();
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem("ea:tab");
      if (saved === "inbox") return "inbox";
      if (saved === "notes") return "notes";
      return "dashboard";
    } catch {
      return "dashboard";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("ea:tab", tab); } catch { /* ignore */ }
  }, [tab]);
  // Warm the lazy inbox chunk after first paint so the first dashboard->inbox
  // switch is instant instead of staring at a blank fetch.
  useWarmImport(importInboxView);
  // Same for the calendar chunk so the first switch to the calendar tab is
  // instant without eager-mounting the heavy modal at boot.
  useWarmImport(importCalendar);
  // And the notes chunk so the first switch to the notes tab is instant.
  useWarmImport(importNotesTab);
  // Mobile shell history is owned here (the parent) so the tab entry and the
  // reader entry are pushed in a deterministic order (tab, then reader) for both
  // entry points: tapping a list row and opening an email from a dashboard rail.
  // On mobile, useInboxSelectionHistory is disabled so this is the single owner.
  const mobileSelectedId = useInboxSelectedId();
  useBrowserBackDismiss({
    enabled: isMobile && tab === "inbox",
    historyKey: "eaDashboardMobileTab",
    onDismiss: () => setTab("dashboard"),
  });
  useBrowserBackDismiss({
    enabled: isMobile && tab === "inbox" && !!mobileSelectedId,
    historyKey: "eaMobileReader",
    onDismiss: () => setInboxSession((prev) => (prev.selectedId ? { ...prev, selectedId: null } : prev)),
  });
  // Declared before setShellTab so the calendar mount-on-first-visit setter is in
  // scope; the calendar tab stays mounted (Activity-frozen) once first visited.
  const [calendarMounted, setCalendarMounted] = useState(false);
  const setShellTab = useCallback((nextTab) => {
    if (nextTab !== "dashboard" && nextTab !== "inbox" && nextTab !== "calendar" && nextTab !== "notes") return;
    if (nextTab === "calendar" && isMobile) return; // desktop-only
    if (nextTab === "calendar") setCalendarMounted(true); // mount-on-first-visit
    if (!isMobile || nextTab === tab) {
      // Non-urgent so the show/hide + re-mounted effects yield to user input.
      startTransition(() => setTab(nextTab));
      return;
    }
    if (tab === "inbox" && nextTab === "dashboard") {
      // Explicit jump to dashboard: unwind the synthetic mobile entries (tab,
      // plus reader if open) in one history traversal. The back-dismiss popstate
      // handlers clear the selection and switch the tab; no extra taps.
      const depth = 1 + (getInboxSession().selectedId ? 1 : 0);
      window.history.go(-depth);
      return;
    }
    startTransition(() => setTab(nextTab));
  }, [isMobile, tab]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [liveReadOverrides, setLiveReadOverrides] = useState({});
  const [historicalSnapshotView, setHistoricalSnapshotView] = useState(null);

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
  // The Analytics modal and Command Palette render a static CSS faux-frost
  // backdrop (see their overlay styles) — no per-open html-to-image rasterization
  // and no live backdrop-filter, so opening them is just a state flip.
  const closeAnalytics = useCallback(() => {
    setAnalyticsOpen(false);
  }, []);
  const openAnalytics = useCallback(() => {
    setAnalyticsOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);
  const openPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);
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
    setShellTab("calendar");
    if (request.shouldLoadDeadlines) loadCalendarDeadlines();
    if (request.shouldLoadBills) loadCalendarBills({ refreshLive: true });
  }, [isMobile, calendarView, showBills, loadCalendarDeadlines, loadCalendarBills, setShellTab]);
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
  // openAnalytics is already a stable useCallback, so it is wired directly.
  const handleHeaderToggleHistory = useCallback(() => setHistoryOpen((v) => !v), [setHistoryOpen]);
  const changeCalendarView = (v) => {
    const nextView = normalizeCalendarWorkspaceView(v);
    setCalendarView(nextView);
    try { localStorage.setItem("calendar:lastView", nextView); } catch { /* ignore */ }
    if (nextView === "bills") loadCalendarBills({ refreshLive: true });
  };

  useEffect(() => {
    // The calendar tab is desktop-only; if the viewport drops to mobile while it
    // is active, fall back to the dashboard. setState-in-effect is intentional
    // here (reacting to an external viewport change), not derivable from render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isMobile && tab === "calendar") setTab("dashboard");
  }, [isMobile, tab]);

  useEffect(() => {
    onCalendarWorkspaceChange?.({
      open: tab === "calendar",
      view: calendarView,
      eventsRange: calendarEventsRangeRef.current,
    });
  }, [tab, calendarView, onCalendarWorkspaceChange]);

  const handleCalendarEventsRangeChange = useCallback((range) => {
    calendarEventsRangeRef.current = range;
    onCalendarWorkspaceChange?.({
      open: tab === "calendar",
      view: calendarView,
      eventsRange: range,
    });
  }, [tab, calendarView, onCalendarWorkspaceChange]);

  // Single signal for "a non-input overlay owns the foreground", gating the global
  // single-key shell hotkeys and ShellHeader's 1/2 tab hotkeys so neither opens overlays
  // behind, nor desyncs the tab from, the open modal.
  const anyBlockingOverlayOpen = analyticsOpen || historyOpen;

  useDashboardShellHotkeys({
    isMobile,
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

  const accent = SHELL_PREFS.accent;
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
    else if (item.kind === "deadline-create") openDeadlineCreate();
    else if (item.kind === "event") openCalendar("events", null, "new");
    else if (item.kind === "analytics") {
      closePalette();
      window.requestAnimationFrame(() => {
        void openAnalytics();
      });
    }
    else if (item.kind === "history") setHistoryOpen(true);
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

  const calendarMountProps = {
    calendarOpenRequestId,
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
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        display: "flex", flexDirection: "column",
        background: [
          `radial-gradient(circle at top, ${accent}08 0%, transparent 24%)`,
          "linear-gradient(180deg, #0b0c12 0%, #0a0b10 100%)",
        ].join(", "),
        color: "var(--sp-text)",
        overflow: "hidden",
      }}
    >
      <ShellHeader
        isMobile={isMobile}
        tab={tab}
        onTab={setShellTab}
        anyBlockingOverlayOpen={anyBlockingOverlayOpen}
        analyticsOpen={analyticsOpen}
        onOpenAnalytics={openAnalytics}
        onOpenPalette={openPalette}
        onOpenHistory={handleHeaderToggleHistory}
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
          overflow: (tab === "dashboard" || tab === "calendar" || tab === "notes") && !isMobile ? "hidden" : "auto",
          overscrollBehavior: "contain",
          minHeight: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 12%)",
        }}
      >
        {/* Both tabs stay mounted via KeepAliveTab (Activity + freeze-when-hidden)
            instead of a ternary that unmounts/remounts per switch — fixes the
            switch freeze + "scroll into blank", and keeps a dashboard data
            refresh from reconciling the hidden tab. */}
        <KeepAliveTab active={tab === "dashboard"}>
          <DashboardBody
            liveData={liveData}
            activeSnapshot={activeSnapshot?.snapshot}
            calendarRange={calendarRange}
            accent={accent}
            isMobile={isMobile}
            calendarDeadlines={dashboardCalendarDeadlines}
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
          />
        </KeepAliveTab>
        <KeepAliveTab active={tab === "inbox"}>
          <Suspense fallback={<InboxMountFallback />}>
            <InboxView
              accent={accent}
              customize={SHELL_PREFS}
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
        </KeepAliveTab>
        {!isMobile && (
          <KeepAliveTab active={tab === "calendar"}>
            {calendarMounted ? (
              <Suspense fallback={null}>
                <DashboardCalendarModalMount {...calendarMountProps} />
              </Suspense>
            ) : null}
          </KeepAliveTab>
        )}
        <KeepAliveTab active={tab === "notes"}>
          <Suspense fallback={null}>
            <NotesTab accent={accent} isMobile={isMobile} />
          </Suspense>
        </KeepAliveTab>
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
        closePalette={closePalette}
        handlePaletteAction={handlePaletteAction}
        analyticsOpen={analyticsOpen}
        closeAnalytics={closeAnalytics}
        historyOpen={historyOpen}
        historicalSnapshotView={historicalSnapshotView}
        activeSnapshot={activeSnapshot}
        historyTriggerRef={historyTriggerRef}
        handleSelectSnapshot={handleSelectSnapshot}
        setHistoryOpen={setHistoryOpen}
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
