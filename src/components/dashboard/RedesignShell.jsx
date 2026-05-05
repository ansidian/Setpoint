import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
import RefreshBanner from "../layout/RefreshBanner";
import ShellHeader from "../shell/ShellHeader";
import { useDashboard } from "../../context/DashboardContext";
import useCustomize from "../../hooks/useCustomize";
import useIsMobile from "../../hooks/useIsMobile";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { collectActiveSnapshotEmails, collectBriefingEmails, mergeReadState } from "../inbox/helpers";
import { DashboardBody } from "./DashboardBody";
import { makeCalendarBillsData } from "./calendarBillsData";
export { DashboardBody };
const AddTaskPanel = lazy(() => import("../todoist/AddTaskPanel"));
const BriefingHistoryPanel = lazy(() => import("../briefing/BriefingHistoryPanel"));
const CalendarModal = lazy(() => import("../calendar/CalendarModal"));
const CommandPalette = lazy(() => import("../shell/CommandPalette"));
const CustomizePanel = lazy(() => import("../shell/CustomizePanel"));
const DeadlineDetailPopover = lazy(() => import("./DeadlineDetailPopover"));
const InboxView = lazy(() => import("../inbox/InboxView"));

export function RedesignShell({
  bd, liveData, calendarRange,
  activeSnapshot,
  onQuickRefresh,
  historyOpen, setHistoryOpen, historyTriggerRef,
  calendarDeadlines, calendarDeadlinesLoading, calendarDeadlinesError = false, loadCalendarDeadlines = () => {},
  calendarBillsData, calendarBillRange, calendarDeadlineRange, loadCalendarBills = () => {},
  onCalendarWorkspaceChange,
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
      if (saved === "deadlines" || saved === "bills" || saved === "events") return saved;
      return "events";
    } catch { return "events"; }
  });
  const showBills = !!liveData.actualConfigured;
  const [calendarFocus, setCalendarFocus] = useState(null);
  const [calendarFocusItemId, setCalendarFocusItemId] = useState(null);
  const [calendarFocusOpenDetail, setCalendarFocusOpenDetail] = useState(false);
  const calendarEventsRangeRef = useRef(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const actionChordRef = useRef(null);
  const actionChordTimerRef = useRef(null);
  const dismissCalendar = useBrowserBackDismiss({
    enabled: !isMobile && calendarOpen,
    historyKey: "eaDashboardCalendarModal",
    onDismiss: () => setCalendarOpen(false),
  });
  const openCalendar = (viewKey, focusDate = null, focusItemId = null, options = {}) => {
    if (isMobile) return;
    const resolved = viewKey === "bills" && !showBills ? "deadlines" : viewKey || calendarView;
    const nextFocusItemId = focusItemId ? String(focusItemId) : null;
    const shouldOpenDetail = !!options.openDetail && nextFocusItemId && nextFocusItemId !== "new";
    setCalendarView(resolved);
    try { localStorage.setItem("calendar:lastView", resolved); } catch { /* ignore */ }
    setCalendarFocus(focusDate || null);
    setCalendarFocusItemId(nextFocusItemId);
    setCalendarFocusOpenDetail(shouldOpenDetail);
    setCalendarOpenRequestId((value) => value + 1);
    setCalendarMounted(true);
    setCalendarOpen(true);
    if (resolved === "deadlines") loadCalendarDeadlines();
    if (resolved === "bills") loadCalendarBills({ refreshLive: true });
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
    else if (item.kind === "history") setHistoryOpen(true);
    else if (item.kind === "customize") setCustomizeOpen(true);
    else if (item.kind === "refresh") onQuickRefresh?.();
    else if (item.kind === "settings") window.location.href = "/settings";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToSection, onQuickRefresh, openTodoistCreate, setShellTab]);

  const eventsData = useMemo(() => ({
    ensureRange: calendarRange.ensureRange,
    refreshRange: calendarRange.refreshRange,
    refreshRangeInPlace: calendarRange.refreshRangeInPlace,
    upsertEvents: calendarRange.upsertEvents,
    removeEvent: calendarRange.removeEvent,
    getEvents: calendarRange.getEvents,
    hasMonth: calendarRange.hasMonth,
    isMonthLoading: calendarRange.isMonthLoading,
    loading: calendarRange.loading,
    staleRefreshPending: calendarRange.staleRefreshPending,
    error: calendarRange.error,
    revision: calendarRange.revision,
    editable: true,
  }), [
    calendarRange.ensureRange,
    calendarRange.refreshRange,
    calendarRange.refreshRangeInPlace,
    calendarRange.upsertEvents,
    calendarRange.removeEvent,
    calendarRange.getEvents,
    calendarRange.hasMonth,
    calendarRange.isMonthLoading,
    calendarRange.loading,
    calendarRange.staleRefreshPending,
    calendarRange.error,
    calendarRange.revision,
  ]);

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

  // Include current snapshot/briefing mail plus live-polled mail in the Inbox badge.
  const liveUnreadCount = useMemo(() => {
    const seen = new Set();
    let unread = 0;

    const addEmail = (email, useReadOverride = false) => {
      const uid = email?.uid || email?.id;
      if (!uid || seen.has(uid)) return;
      seen.add(uid);
      const read = useReadOverride
        ? mergeReadState(email.read, uid, liveReadOverrides)
        : !!email.read;
      if (!read) unread += 1;
    };

    const usingSnapshot = !!activeSnapshot?.snapshot?.snapshot;
    const baseEmails = usingSnapshot
      ? collectActiveSnapshotEmails(activeSnapshot.snapshot, liveReadOverrides)
      : collectBriefingEmails(briefing?.emails?.accounts || []);
    for (const email of baseEmails) addEmail(email, usingSnapshot);

    for (const email of liveData.liveEmails || []) {
      addEmail(email, true);
    }

    for (const entry of liveData.resurfacedEntries || []) {
      addEmail(entry, true);
    }

    return unread;
  }, [activeSnapshot?.snapshot, briefing?.emails?.accounts, liveData.liveEmails, liveData.resurfacedEntries, liveReadOverrides]);

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
        isMobile={isMobile}
        tab={tab}
        onTab={setShellTab}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenCustomize={() => setCustomizeOpen((v) => !v)}
        onOpenHistory={() => setHistoryOpen((v) => !v)}
        onOpenCalendar={() => openCalendar()}
        liveUnreadCount={liveUnreadCount}
        refreshing={bd.refreshing}
        generating={bd.generating}
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
            viewingPast={bd.viewingPast}
            onOpenEmail={openEmailInInbox}
            onOpenDeadline={(task, anchor) => {
              if (!isMobile) {
                openCalendar("deadlines", task?.due_date || null, task?.id || null, {
                  source: "dashboard",
                  openDetail: !!task?.id,
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
            })}
            onOpenDeadlinesCalendar={(date, itemId) => openCalendar("deadlines", date || null, itemId || null, {
              source: "dashboard",
              openDetail: !!itemId,
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
              emailAccounts={briefing?.emails?.accounts || []}
              briefingSummary={briefing?.emails?.summary}
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
              isMobile={isMobile}
            />
          </Suspense>
        )}
      </div>

      {isMobile && deadlinePopover && (
        <Suspense fallback={null}>
          <DeadlineDetailPopover
            task={deadlinePopover.task}
            anchor={deadlinePopover.anchor}
            accent={accent}
            onClose={() => setDeadlinePopover(null)}
          />
        </Suspense>
      )}

      {isMobile && addTaskOpen && (
        <Suspense fallback={null}>
          <AddTaskPanel
            host="anchored"
            onClose={() => setAddTaskOpen(false)}
            onTaskAdded={(task) => {
              handleAddTask(task);
              queueCalendarDeadlineRefresh();
              setAddTaskOpen(false);
            }}
          />
        </Suspense>
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            accent={accent}
            onClose={() => setPaletteOpen(false)}
            onAction={handlePaletteAction}
          />
        </Suspense>
      )}

      {customizeOpen && (
        <Suspense fallback={null}>
          <CustomizePanel
            open={customizeOpen}
            onClose={() => setCustomizeOpen(false)}
            customize={customize}
            tab={tab}
            isMobile={isMobile}
          />
        </Suspense>
      )}

      {historyOpen && (
        <Suspense fallback={null}>
          <BriefingHistoryPanel
            activeId={historicalSnapshotView?.snapshot?.id ?? activeSnapshot?.snapshot?.snapshot?.id ?? null}
            triggerRef={historyTriggerRef}
            onSelectSnapshot={handleSelectSnapshot}
            onClose={() => setHistoryOpen(false)}
          />
        </Suspense>
      )}

      {!isMobile && calendarMounted && (
        <Suspense fallback={null}>
          <CalendarModal
            open={calendarOpen}
            openRequestId={calendarOpenRequestId}
            onClose={dismissCalendar}
            view={calendarView}
            onViewChange={changeCalendarView}
            focusDate={calendarFocus}
            focusItemId={calendarFocusItemId}
            focusOpenDetail={calendarFocusOpenDetail}
            eventsData={eventsData}
            onEventsVisibleRangeChange={handleCalendarEventsRangeChange}
            weatherData={liveData.liveWeather || briefing?.weather || null}
            billsData={calendarBillsData || makeCalendarBillsData(liveData)}
            billsRangeData={calendarBillRange}
            deadlinesData={{
              ctm: calendarDeadlines?.ctm || { upcoming: [], stats: null },
              todoist: calendarDeadlines?.todoist || { upcoming: [], stats: null },
              isLoading: calendarDeadlinesLoading && !calendarDeadlines,
            }}
            deadlinesRangeData={calendarDeadlineRange}
            deadlineActions={calendarDeadlineActions}
          />
        </Suspense>
      )}
    </div>
  );
}
