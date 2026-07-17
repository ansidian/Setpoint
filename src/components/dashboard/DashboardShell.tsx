import { useState, useEffect, useLayoutEffect, useMemo, lazy, Suspense, useCallback, startTransition } from "react";
import type { ComponentType, Dispatch, RefObject, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import ShellHeader from "../shell/ShellHeader";
import { MobileBottomNav } from "../shell/MobileBottomNav";
import { TAB_LABELS } from "../shell/ShellTabs";
import { useDashboard } from "../../context/DashboardContext";
import { readDemoSafeLocalStorage, writeDemoSafeLocalStorage } from "../../demo/demoSafeLocalStorage";
import useIsMobile from "../../hooks/useIsMobile";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { DashboardBody } from "./DashboardBody";
import DashboardShellOverlays from "./DashboardShellOverlays";
import DashboardCalendarModalMount, { importCalendar } from "./DashboardCalendarModalMount";
import InboxMountFallback from "./InboxMountFallback";
import KeepAliveTab from "./KeepAliveTab";
import useWarmImport from "../../hooks/useWarmImport";
import { useUtilityPayLinks } from "../../hooks/useUtilityPayLinks";
import { buildDashboardEventsData } from "./dashboardShellModel";
import useDashboardShellHotkeys from "./useDashboardShellHotkeys";
import useCalendarWorkspaceState from "./useCalendarWorkspaceState";
import useAlfredPanelState from "./useAlfredPanelState";
import useLiveReadOverrides from "./useLiveReadOverrides";
import useDashboardItemSheet from "./useDashboardItemSheet";
import useMobileDashboardScrollRestoration from "./useMobileDashboardScrollRestoration";
import { scrollToSection } from "./scrollToSection";
import { getInboxSession, resetInboxSession, setInboxSession, useInboxSelectedId } from "../inbox/useInboxSessionState";
import type { CurrentDashboardHookResult } from "../../hooks/useCurrentDashboard";
import type useCalendarRange from "../../hooks/calendar/useCalendarRange";
import type { DashboardDeadline, DashboardDeadlineRoot } from "../../context/dashboardTaskProjection";
import type { ActiveSnapshotView, SnapshotView } from "../../../shared/types/snapshots";
import type { DashboardCalendarBillsData } from "./calendarBillsData";
import type { DashboardCalendarModalMountProps } from "./DashboardCalendarModalMount";
import type { CalendarOpenRequest, DashboardTab } from "./dashboardShellModel";
import type { DashboardCalendarWorkspaceState } from "./useCalendarWorkspaceState";
import type { DashboardActiveSnapshotController } from "./useLiveReadOverrides";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { ActualBillOccurrence } from "../../../shared/types/actual";
export { DashboardBody };

export type DashboardShellLiveData = Omit<Partial<CurrentDashboardHookResult["liveData"]>,
  "liveBills" | "liveEmails" | "snoozedEntries" | "resurfacedEntries"
> & {
  liveBills?: Array<Partial<ActualBillOccurrence>>;
  liveEmails?: Array<Record<string, unknown>>;
  snoozedEntries?: Array<Record<string, unknown>>;
  resurfacedEntries?: Array<Record<string, unknown>>;
};
// Single import factory so the inbox chunk can be both lazy-mounted and warmed
// in the background after the dashboard paints; the bundler dedupes to one fetch.
const importInboxView = () => import("../inbox/InboxView");
interface DashboardInboxViewProps {
  accent: string;
  customize: typeof SHELL_PREFS;
  emailAccounts: [];
  briefingSummary: string;
  briefingGeneratedAt?: unknown;
  liveEmails: [];
  liveEmailsLoading: boolean;
  activeSnapshot: {
    snapshot: ActiveSnapshotView | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<unknown>;
    sync: () => Promise<unknown>;
  };
  liveReadOverrides: Record<string, boolean>;
  onLiveReadOverrideChange: (uid: string, read: boolean) => void;
  snoozedEntries: [];
  resurfacedEntries: [];
  onOpenDashboard: () => void;
  onRefresh?: () => unknown;
  commitPendingUndoSignal: number;
  isMobile: boolean;
  onAskAlfred: (query: string) => void;
}
const InboxView = lazy(importInboxView) as unknown as ComponentType<DashboardInboxViewProps>;
const importNotesTab = () => import("../notes/NotesTab");
const NotesTab = lazy(importNotesTab);
const importNewsTab = () => import("../news/NewsTab");
const NewsTab = lazy(importNewsTab);
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

// ShellTabs (the tablist owning id="shell-tab-{key}") only renders on desktop
// (see ShellHeader's `{!isMobile && <ShellTabs ... />}`), so on mobile the
// id a tabpanel's aria-labelledby would point at doesn't exist — a dangling
// IDREF. Fall back to a plain aria-label built from the same TAB_LABELS the
// desktop tabs already use, rather than introducing a second label table.
function tabPanelA11yProps(key: DashboardTab, isMobile: boolean) {
  return isMobile
    ? { "aria-label": TAB_LABELS[key] }
    : { "aria-labelledby": `shell-tab-${key}` };
}

export interface DashboardShellProps {
  bd: Partial<CurrentDashboardHookResult["briefingData"]> & { briefing: CurrentDashboardHookResult["briefingData"]["briefing"]; refreshing: boolean };
  liveData: DashboardShellLiveData;
  calendarRange: ReturnType<typeof useCalendarRange> | Record<string, never>;
  activeSnapshot?: DashboardActiveSnapshotController;
  onQuickRefresh?: () => unknown;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  historyTriggerRef: RefObject<HTMLDivElement | null>;
  calendarDeadlines?: DashboardDeadlineRoot | null;
  calendarDeadlinesLoading?: boolean;
  calendarDeadlinesError?: boolean;
  loadCalendarDeadlines?: (options?: { force?: boolean }) => void;
  calendarBillsData?: Partial<DashboardCalendarBillsData> | null;
  calendarBillRange?: DashboardCalendarModalMountProps["calendarBillRange"];
  calendarDeadlineRange?: DashboardCalendarModalMountProps["calendarDeadlineRange"];
  domainRefreshing?: boolean;
  loadCalendarBills?: (options?: { force?: boolean; refreshLive?: boolean }) => void;
  onCalendarWorkspaceChange?: (workspace: DashboardCalendarWorkspaceState) => void;
}

export function DashboardShell({
  bd: bdInput, liveData: liveDataInput, calendarRange: calendarRangeInput,
  activeSnapshot = { snapshot: null, loading: false, error: null, refresh: async () => null, sync: async () => null },
  onQuickRefresh,
  historyOpen, setHistoryOpen, historyTriggerRef, calendarDeadlines, calendarDeadlinesLoading = false,
  calendarDeadlinesError = false, loadCalendarDeadlines = () => {}, calendarBillsData, calendarBillRange,
  calendarDeadlineRange, domainRefreshing = false, loadCalendarBills = () => {}, onCalendarWorkspaceChange,
}: DashboardShellProps) {
  type InboxSession = { accountId: string; lane: string; search: string; selectedId: string | number | null };
  const bd = bdInput as CurrentDashboardHookResult["briefingData"];
  const liveData = liveDataInput as CurrentDashboardLiveData;
  const calendarRange = calendarRangeInput as ReturnType<typeof useCalendarRange>;
  const isMobile = useIsMobile();
  const {
    handleAddTask,
    handleCompleteTask,
    handleDeleteTask,
    handleMoveTask,
  } = useDashboard();
  const [tab, setTab] = useState<DashboardTab>(() => {
    try {
      const saved = readDemoSafeLocalStorage("ea:tab");
      if (saved === "inbox") return "inbox";
      if (saved === "notes") return "notes";
      return "dashboard";
    } catch {
      return "dashboard";
    }
  });
  useEffect(() => {
    writeDemoSafeLocalStorage("ea:tab", tab);
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
  // Warm heavier secondary tabs on desktop only; mobile loads them on first use.
  useWarmImport(importCalendar, { enabled: !isMobile });
  useWarmImport(importNotesTab, { enabled: !isMobile });
  useWarmImport(importNewsTab, { enabled: !isMobile });
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
    onDismiss: () => setInboxSession((prev: InboxSession) => (prev.selectedId ? { ...prev, selectedId: null } : prev)),
  });
  // Declared before setShellTab so the calendar mount-on-first-visit setter is in
  // scope; the calendar tab stays mounted (Activity-frozen) once first visited.
  const [calendarMounted, setCalendarMounted] = useState(false);
  // Same mount-on-first-visit treatment for news: it fetches on mount, so avoid
  // eagerly hitting the news API before the owner ever opens the tab.
  const [newsMounted, setNewsMounted] = useState(false);
  const setShellTab = useCallback((nextTab: DashboardTab) => {
    if (nextTab !== "dashboard" && nextTab !== "inbox" && nextTab !== "calendar" && nextTab !== "notes" && nextTab !== "news") return;
    if (nextTab === "calendar") setCalendarMounted(true); // mount-on-first-visit
    if (nextTab === "news") setNewsMounted(true); // mount-on-first-visit
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
  const [historicalSnapshotView, setHistoricalSnapshotView] = useState<SnapshotView | null>(null);
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
  const handleAlfredOpenCalendarItem = useCallback((request: CalendarOpenRequest) => {
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
  const jumpToSection = useCallback((slug: string) => {
    setShellTab("dashboard");
    scrollToSection(slug);
  }, [setShellTab]);

  // Email click anywhere → switch to inbox and let its state handle selection.
  const openEmailInInbox = useCallback((id: string | number | null) => {
    setHistoricalSnapshotView(null);
    if (id) {
      setInboxSession((prev: InboxSession) => ({
        ...prev,
        selectedId: id,
      }));
    }
    setShellTab("inbox");
  }, [setShellTab]);



  const inboxActiveSnapshot = useMemo(() => {
    if (!historicalSnapshotView) return activeSnapshot;
    return {
      snapshot: historicalSnapshotView as ActiveSnapshotView,
      loading: false,
      error: null,
      refresh: async () => {},
      sync: async () => {},
    };
  }, [activeSnapshot, historicalSnapshotView]);

  const handleSelectSnapshot = useCallback((snapshotView: SnapshotView | null, meta?: { readOnly?: boolean }) => {
    if (meta?.readOnly) {
      setHistoricalSnapshotView(snapshotView);
    } else {
      setHistoricalSnapshotView(null);
    }
    resetInboxSession();
    setShellTab("inbox");
    setHistoryOpen(false);
  }, [setHistoryOpen, setShellTab]);

  const {
    itemSheet,
    close: closeItemSheet,
    openDeadline: openDashboardDeadline,
    openBill: openDashboardBill,
    openEvent: openDashboardEvent,
    openInCalendar: openItemSheetInCalendar,
  } = useDashboardItemSheet({ tab, openCalendar });
  const handleInboxOpenRecordedBill = useCallback(({ date, itemId }) => {
    openDashboardBill(date, itemId);
  }, [openDashboardBill]);
  const billPayLinksByScheduleId = useUtilityPayLinks();

  const {
    scrollRef: dashboardScrollRef,
    onScroll: handleSharedScroll,
  } = useMobileDashboardScrollRestoration({ isMobile, tab });

  const navigate = useNavigate();
  const handlePaletteAction = useCallback((item: { kind: string; payload?: string }) => {
    if (item.kind === "tab" && item.payload) setShellTab(item.payload as DashboardTab);
    else if (item.kind === "scroll" && item.payload) jumpToSection(item.payload);
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
    onCompleteTask: (taskId: string, task?: DashboardDeadline | null) => {
      const result = handleCompleteTask(taskId, task);
      queueCalendarDeadlineRefresh();
      return result;
    },
    onDeleteTask: (taskId: string) => {
      const result = handleDeleteTask(taskId);
      queueCalendarDeadlineRefresh();
      return result;
    },
    onMoveTask: (task: DashboardDeadline, targetDate: string) => {
      const result = handleMoveTask(task, targetDate);
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
  } as DashboardCalendarModalMountProps;

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
        data-scroll-lock-target=""
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
        {/* role="tabpanel" wrapper per panel, named via tabPanelA11yProps
            (A11Y-05): aria-labelledby the desktop ShellTabs button when it
            exists, else (mobile, where ShellTabs doesn't render) a plain
            aria-label from the same TAB_LABELS — a dangling aria-labelledby
            otherwise. KeepAliveTab renders no DOM node of its own (Activity +
            a memo pass-through), so the wrapper lives INSIDE it, as a direct
            child of Activity — Activity hides a subtree by setting
            display:none!important on each host instance within it, so this
            wrapper's display:contents is hidden/restored right along with the
            rest of an inactive tab's DOM. Does not touch KeepAliveTab itself. */}
        <KeepAliveTab active={tab === "dashboard"}>
          <div
            role="tabpanel"
            id="shell-tabpanel-dashboard"
            {...tabPanelA11yProps("dashboard", isMobile)}
            style={{ display: "contents" }}
          >
            <DashboardBody
              liveData={liveData}
              activeSnapshot={activeSnapshot?.snapshot}
              calendarRange={calendarRange}
              accent={accent}
              isMobile={isMobile}
              calendarDeadlines={dashboardCalendarDeadlines}
              calendarDeadlinesLoading={calendarDeadlinesLoading}
              calendarDeadlinesError={!!calendarDeadlinesError}
              domainRefreshing={domainRefreshing}
              onOpenEmail={openEmailInInbox}
              onOpenDeadline={openDashboardDeadline}
              onOpenBillsCalendar={openDashboardBill}
              onOpenEventsCalendar={openDashboardEvent}
            />
          </div>
        </KeepAliveTab>
        <KeepAliveTab active={tab === "inbox"}>
          <div
            role="tabpanel"
            id="shell-tabpanel-inbox"
            {...tabPanelA11yProps("inbox", isMobile)}
            style={{ display: "contents" }}
          >
            <Suspense fallback={<InboxMountFallback />}>
              <InboxView
                accent={accent}
                customize={SHELL_PREFS}
                emailAccounts={[]}
                briefingSummary=""
                briefingGeneratedAt={undefined}
                liveEmails={liveData.liveEmails}
                liveEmailsLoading={liveEmailsLoading}
                activeSnapshot={inboxActiveSnapshot}
                liveReadOverrides={liveReadOverrides}
                onLiveReadOverrideChange={handleLiveReadOverrideChange}
                snoozedEntries={liveData.snoozedEntries}
                resurfacedEntries={liveData.resurfacedEntries}
                onOpenDashboard={() => setShellTab("dashboard")}
                onOpenRecordedBill={handleInboxOpenRecordedBill}
                onRefresh={onQuickRefresh}
                commitPendingUndoSignal={calendarOpenRequestId}
                isMobile={isMobile}
                onAskAlfred={askAlfred}
              />
            </Suspense>
          </div>
        </KeepAliveTab>
        <KeepAliveTab active={tab === "calendar"}>
          <div
            role="tabpanel"
            id="shell-tabpanel-calendar"
            {...tabPanelA11yProps("calendar", isMobile)}
            style={{ display: "contents" }}
          >
            {calendarMounted ? (
              <Suspense fallback={null}>
                <DashboardCalendarModalMount {...calendarMountProps} />
              </Suspense>
            ) : null}
          </div>
        </KeepAliveTab>
        <KeepAliveTab active={tab === "notes"}>
          <div
            role="tabpanel"
            id="shell-tabpanel-notes"
            {...tabPanelA11yProps("notes", isMobile)}
            style={{ display: "contents" }}
          >
            <Suspense fallback={null}>
              <NotesTab accent={accent} isMobile={isMobile} />
            </Suspense>
          </div>
        </KeepAliveTab>
        <KeepAliveTab active={tab === "news"}>
          <div
            role="tabpanel"
            id="shell-tabpanel-news"
            {...tabPanelA11yProps("news", isMobile)}
            style={{ display: "contents" }}
          >
            {newsMounted ? (
              <Suspense fallback={null}>
                <NewsTab active={tab === "news"} />
              </Suspense>
            ) : null}
          </div>
        </KeepAliveTab>
      </div>

      {isMobile && (
        <MobileBottomNav
          tab={tab}
          onTab={setShellTab}
          onRetap={(t: DashboardTab) => { if (t === "calendar") jumpCalendarToToday(); }}
          inboxUnreadSignalCount={inboxUnreadSignalCount}
        />
      )}

      <DashboardShellOverlays
        isMobile={isMobile}
        itemSheet={itemSheet}
        closeItemSheet={closeItemSheet}
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
