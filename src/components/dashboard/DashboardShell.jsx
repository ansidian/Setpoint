import { useState, useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense, useCallback, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import ShellHeader from "../shell/ShellHeader";
import { MobileBottomNav } from "../shell/MobileBottomNav.jsx";
import { useDashboard } from "../../context/DashboardContext";
import useIsMobile from "../../hooks/useIsMobile";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { DashboardBody } from "./DashboardBody";
import DashboardShellOverlays from "./DashboardShellOverlays.jsx";
import DashboardCalendarModalMount, { importCalendar } from "./DashboardCalendarModalMount.jsx";
import InboxMountFallback from "./InboxMountFallback.jsx";
import KeepAliveTab from "./KeepAliveTab.jsx";
import useWarmImport from "../../hooks/useWarmImport";
import { useUtilityPayLinks } from "../../hooks/useUtilityPayLinks";
import {
  buildDashboardEventsData,
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  nextItemSheet,
} from "./dashboardShellModel.js";
import useDashboardShellHotkeys from "./useDashboardShellHotkeys.js";
import useCalendarWorkspaceState from "./useCalendarWorkspaceState.js";
import useAlfredPanelState from "./useAlfredPanelState.js";
import useLiveReadOverrides from "./useLiveReadOverrides.js";
import { scrollToSection } from "./scrollToSection.js";
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
    handleMoveTask,
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
  // Reflect the active tab as a root attribute so global CSS can hide
  // calendar-owned document.body portals (the floating detail panel) when the
  // calendar isn't the active tab. The calendar mounts as a KeepAlive
  // (Activity-frozen) tab, so on leave it can't re-render to retract its own
  // body portal — this lets the (non-frozen) shell drive the hide. Layout
  // effect runs before paint so the panel never flashes over the new tab.
  useLayoutEffect(() => {
    document.documentElement.dataset.activeTab = tab;
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
  const [historicalSnapshotView, setHistoricalSnapshotView] = useState(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const {
    alfredOpen,
    alfredMounted,
    alfredNewChatTick,
    alfredHandoff,
    toggleAlfred,
    closeAlfred,
    alfredNewChat,
    askAlfred,
  } = useAlfredPanelState();

  const { liveReadOverrides, handleLiveReadOverrideChange, inboxUnreadSignalCount } =
    useLiveReadOverrides({ activeSnapshot, liveData });

  const {
    calendarOpenRequestId,
    calendarJumpTodayRequestId,
    calendarView,
    calendarFocus,
    calendarFocusItemId,
    calendarFocusOpenDetail,
    calendarForceOverlays,
    openCalendar,
    jumpCalendarToToday,
    changeCalendarView,
    handleCalendarEventsRangeChange,
  } = useCalendarWorkspaceState({
    isMobile,
    tab,
    setShellTab,
    setCalendarMounted,
    liveData,
    loadCalendarDeadlines,
    loadCalendarBills,
    onCalendarWorkspaceChange,
  });

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
  const openDeadlineCreate = useCallback(() => {
    if (isMobile) {
      setAddTaskOpen(true);
      return;
    }
    openCalendar("events", null, "new", { source: "dashboard", forceDeadlineOverlay: true });
  }, [isMobile, openCalendar]);
  // Stable handler for AlfredPanel chip deep-links — depends only on the now-stable
  // closeAlfred + openCalendar, so the memoized panel can bail on unrelated parent
  // re-renders.
  const handleAlfredOpenCalendarItem = useCallback((request) => {
    closeAlfred();
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [closeAlfred, openCalendar]);

  // Stable ShellHeader callbacks so the memoized header (+ its chrome children)
  // stop re-rendering on every dashboard SSE/refresh re-render of DashboardShell.
  // openAnalytics is already a stable useCallback, so it is wired directly.
  const handleHeaderToggleHistory = useCallback(() => setHistoryOpen((v) => !v), [setHistoryOpen]);

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
    scrollToSection(slug);
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

  // Unified glance sheet for a dashboard item tap (deadline/bill/event): opens the
  // detail in place — anchored panel on desktop, bottom sheet on mobile — instead
  // of jumping to the calendar + floating detail. Holds { kind, item, date, itemId,
  // anchorRef }; "Open in calendar" is the explicit deep-link out.
  const [itemSheet, setItemSheet] = useState(null);
  // The glance sheet belongs to the dashboard tab: it is a document.body portal
  // anchored to a dashboard card. Once you switch tabs (2/3/4) that anchor sits
  // in the Activity-frozen dashboard subtree, so its getBoundingClientRect()
  // returns 0,0 and the panel would re-place itself in the top-left corner.
  // Unlike the calendar's floating panel — whose frozen owner can't retract it,
  // so global CSS hides it (commit 51a34c4) — this sheet's owner (DashboardShell)
  // is always live, so it simply closes itself on leave.
  useLayoutEffect(() => {
    if (tab === "dashboard") return;
    // Reacting to a tab transition (external navigation), not deriving render
    // state; the guarded update no-ops when the sheet is already closed. Keyed on
    // `tab` so every leave path is covered (header/hotkey tabs, mobile nav). A
    // layout effect runs before paint, so the stale sheet never flashes top-left.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemSheet((cur) => (cur ? null : cur));
  }, [tab]);
  const billPayLinksByScheduleId = useUtilityPayLinks();

  // The bill/event deep-link openers, shared by the desktop tap path AND the
  // mobile sheet's "Open in calendar" action (which scrolls the agenda to the
  // item via the focusDate the request carries).
  const openBillInCalendar = useCallback((date, itemId) => {
    const request = dashboardBillCalendarRequest(date, itemId);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);
  const openEventInCalendar = useCallback((date, itemId) => {
    openCalendar("events", date || null, itemId, {
      source: "dashboard",
      openDetail: !!itemId && itemId !== "new",
      forceEventOverlay: !!itemId && itemId !== "new",
    });
  }, [openCalendar]);
  // The glance sheet's "Open in calendar" action: close the sheet and run the same
  // deep-link the dashboard tap used to run directly (kind-aware), which switches to
  // the calendar tab and opens the item's native detail.
  const openItemSheetInCalendar = useCallback((sheet) => {
    setItemSheet(null);
    if (!sheet) return;
    if (sheet.kind === "deadline") {
      const request = dashboardDeadlineCalendarRequest(sheet.item);
      openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
    } else if (sheet.kind === "bill") {
      openBillInCalendar(sheet.date, sheet.itemId);
    } else {
      openEventInCalendar(sheet.date, sheet.itemId);
    }
  }, [openCalendar, openBillInCalendar, openEventInCalendar]);

  // Mobile-only: the four tabs share one scroll container, so switching to a
  // shorter tab (the inbox owns its own inner scroller) collapses the shared
  // scrollHeight and the browser clamps the dashboard's scrollTop to 0. We record
  // the dashboard's offset live while it is the active tab (so the saved value is
  // never the post-switch clamp), then restore it on return — re-applying on the
  // next frame, after the revealed content re-expands, to beat the clamp.
  const dashboardScrollRef = useRef(null);
  const dashboardScrollTopRef = useRef(0);
  const handleSharedScroll = useCallback((event) => {
    if (isMobile && tab === "dashboard") {
      dashboardScrollTopRef.current = event.currentTarget.scrollTop;
    }
  }, [isMobile, tab]);
  useLayoutEffect(() => {
    if (!isMobile || tab !== "dashboard") return undefined;
    const el = dashboardScrollRef.current;
    if (!el) return undefined;
    const target = dashboardScrollTopRef.current;
    el.scrollTop = target;
    const raf = window.requestAnimationFrame(() => {
      if (dashboardScrollRef.current) dashboardScrollRef.current.scrollTop = target;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [tab, isMobile]);

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
    onMoveTask: (...args) => {
      const result = handleMoveTask(...args);
      queueCalendarDeadlineRefresh();
      return result;
    },
  }), [
    handleCompleteTask,
    handleDeleteTask,
    handleMoveTask,
    queueCalendarDeadlineRefresh,
  ]);

  const calendarMountProps = {
    calendarOpenRequestId,
    calendarJumpTodayRequestId,
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
        // Transparent so the body's Catppuccin Mocha canvas shows through:
        // var(--sp-page) base + 5% accent top-glow + var(--sp-dot) dot-grid (see
        // src/index.css `body`, matching the design mockup). Previously an OPAQUE
        // #0b0c12->#0a0b10 near-black gradient was painted here, covering the
        // textured canvas and flattening the dashboard to near-black.
        background: "transparent",
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
        ref={dashboardScrollRef}
        onScroll={handleSharedScroll}
        data-testid="shell-scroll-region"
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
              setItemSheet((prev) => nextItemSheet(prev, { kind: "deadline", item: task, anchorRef: { current: anchor || null } }));
            }}
            onOpenBillsCalendar={(date, itemId, item, anchor) => {
              if (item) { setItemSheet((prev) => nextItemSheet(prev, { kind: "bill", item, date, itemId, anchorRef: { current: anchor || null } })); return; }
              openBillInCalendar(date, itemId);
            }}
            onOpenEventsCalendar={(date, itemId, item, anchor) => {
              if (item) { setItemSheet((prev) => nextItemSheet(prev, { kind: "event", item, date, itemId, anchorRef: { current: anchor || null } })); return; }
              openEventInCalendar(date, itemId);
            }}
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
        <KeepAliveTab active={tab === "calendar"}>
          {calendarMounted ? (
            <Suspense fallback={null}>
              <DashboardCalendarModalMount {...calendarMountProps} />
            </Suspense>
          ) : null}
        </KeepAliveTab>
        <KeepAliveTab active={tab === "notes"}>
          <Suspense fallback={null}>
            <NotesTab accent={accent} isMobile={isMobile} />
          </Suspense>
        </KeepAliveTab>
      </div>

      {isMobile && (
        <MobileBottomNav
          tab={tab}
          onTab={setShellTab}
          onRetap={(t) => { if (t === "calendar") jumpCalendarToToday(); }}
          inboxUnreadSignalCount={inboxUnreadSignalCount}
        />
      )}

      <DashboardShellOverlays
        isMobile={isMobile}
        itemSheet={itemSheet}
        setItemSheet={setItemSheet}
        onOpenItemInCalendar={openItemSheetInCalendar}
        billCtx={{ actualBudgetUrl: calendarBillsData?.actualBudgetUrl, payLinksByScheduleId: billPayLinksByScheduleId }}
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
