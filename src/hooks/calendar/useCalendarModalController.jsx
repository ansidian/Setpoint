import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "../../components/calendar/views/billsView.jsx";
import deadlinesView from "../../components/calendar/views/deadlinesView.jsx";
import eventsView from "../../components/calendar/views/eventsView.jsx";
import { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.js";
import useCalendarEventEditor from "../../components/calendar/events/useCalendarEventEditor.js";
import useCalendarQuickActions from "../../components/calendar/events/useCalendarQuickActions.js";
import useDeadlineQuickActions from "../../components/calendar/views/deadlines/useDeadlineQuickActions.js";
import CalendarModalShell from "../../components/calendar/modal/CalendarModalShell.jsx";
import buildCalendarModalShellProps from "../../components/calendar/modal/buildCalendarModalShellProps.js";
import {
  getVisibleGridRange,
  parseYmd,
  ymdFromParts,
} from "../../components/calendar/calendarDateUtils.js";
import useCalendarFloatingDetail from "./useCalendarFloatingDetail.js";
import useCalendarModalEditorRouting from "./useCalendarModalEditorRouting.js";
import useCalendarModalHotkeys from "./useCalendarModalHotkeys.js";
import useCalendarModalOutsideDismiss from "./useCalendarModalOutsideDismiss.js";
import useCalendarModalSelection from "./useCalendarModalSelection.js";
import useCalendarModalViewModel from "./useCalendarModalViewModel.js";
import useCalendarModalWheelContainment from "./useCalendarModalWheelContainment.js";
import useViewportWidth from "./useViewportWidth.js";

const VIEWS = {
  events: eventsView,
  bills: billsView,
  deadlines: deadlinesView,
};
const DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsDeadlineOverlay";
const COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY = "calendar:eventsCompletedDeadlines";

function readStoredBoolean(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return fallback;
  }
  return fallback;
}

function writeStoredBoolean(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // localStorage is an enhancement for this modal preference.
  }
}

function addMonthOffset(year, month, offset) {
  const date = new Date(year, month + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function eventCacheKey(event) {
  if (!event?.id) return null;
  return event.originalStartTime ? `${event.id}::${event.originalStartTime}` : String(event.id);
}

function dedupeEvents(events) {
  const seen = new Set();
  const result = [];
  for (const event of events) {
    const key = eventCacheKey(event);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(event);
  }
  return result;
}

function itemsFromDatePool(activeView, pool) {
  if (!pool) return [];
  if (Array.isArray(pool)) return pool;
  if (Array.isArray(pool.items)) return pool.items;
  const state = activeView?.getDayState?.(pool);
  if (Array.isArray(state?.items)) return state.items;
  return [];
}

function isCompleteItem(item) {
  return item?.status === "complete";
}

function itemDueDate(item) {
  return item?.agendaDateKey || item?.due_date || item?.next_date || null;
}

function rangeMatches(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end;
}

function makeDeadlineOverlayRecord(data, range) {
  return data && range ? { data, range } : null;
}

function deadlineOverlayRecordData(record, visibleRange) {
  if (!record) return null;
  if (record.range && !rangeMatches(record.range, visibleRange)) return null;
  return record.data || record;
}

function resolvePendingFocusItem({ activeView, computed, dateKey, itemId }) {
  const getItemId = activeView?.getItemId || ((item) => item?.id);
  const matches = (item) => (
    activeView?.matchesItemId?.(item, itemId)
    || String(getItemId(item)) === String(itemId)
    || String(item?.id) === String(itemId)
  );
  const sameDateCandidates = itemsFromDatePool(activeView, computed?.itemsByDate?.[dateKey]);
  const sameDateOpen = sameDateCandidates.find((item) => matches(item) && !isCompleteItem(item));
  if (sameDateOpen) return sameDateOpen;

  const allByDate = computed?.itemsByDate || {};
  const allMatches = Object.entries(allByDate)
    .flatMap(([candidateDateKey, pool]) => (
      itemsFromDatePool(activeView, pool)
        .filter((item) => matches(item))
        .map((item) => ({ item, candidateDateKey }))
    ));
  const openMatch = allMatches.find(({ item }) => !isCompleteItem(item));
  if (openMatch) return openMatch.item;

  return sameDateCandidates.find((item) => matches(item))
    || allMatches.find(({ item }) => itemDueDate(item) === dateKey)?.item
    || allMatches[0]?.item
    || null;
}

export default function useCalendarModalController({
  open,
  onClose,
  view,
  onViewChange,
  eventsData,
  onEventsVisibleRangeChange,
  billsData,
  billsRangeData,
  deadlinesData,
  deadlinesRangeData,
  weatherData,
  focusDate,
  focusItemId,
  focusOpenDetail = false,
  forceDeadlineOverlay = false,
  openRequestId = 0,
  deadlineActions = {},
}) {
  const {
    currentMonth,
    currentYear,
    todayDate,
    setViewDate,
    selectedDay,
    setSelectedDay,
    selectedDateKey,
    setSelectedDateKey,
    selectedItemId,
    setSelectedItemId,
    activeViewDate,
    activeSelectedDay,
    activeSelectedDateKey,
    activeSelectedItemId,
    syncSnapshot,
    commitSyncSnapshot: commitSelectionSyncSnapshot,
    focusDateKey,
  } = useCalendarModalSelection({
    open,
    view,
    focusDate,
    focusItemId,
    openRequestId,
  });
  const todayDateKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const isInitialDeadlineCreateRequest = open
    && focusItemId === "new"
    && (
      view === "deadlines"
      || (view === "events" && forceDeadlineOverlay)
    );
  const [deadlineEditor, setDeadlineEditor] = useState(() => (
    isInitialDeadlineCreateRequest
      ? {
          mode: "create",
          seedDate: focusDate || (view === "events" && forceDeadlineOverlay ? todayDateKey : null),
        }
      : null
  ));
  const viewportWidth = useViewportWidth();
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState(null);
  const [deadlineOverlayVisible, setDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [completedDeadlineOverlayVisible, setCompletedDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [committedDeadlineOverlayData, setCommittedDeadlineOverlayData] = useState(null);
  const [lateDeadlineOverlayData, setLateDeadlineOverlayData] = useState(null);
  const [planningReadiness, setPlanningReadiness] = useState({
    state: "idle",
    slowSource: null,
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
    eventsReadyAt: null,
    deadlinesReadyAt: null,
  });
  const [manualMonthBrowseKey, setManualMonthBrowseKey] = useState(0);
  const [workspaceTransientCloseToken, setWorkspaceTransientCloseToken] = useState(0);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [agendaScrollCommand, setAgendaScrollCommand] = useState(null);
  const [pendingItemDetailFocus, setPendingItemDetailFocus] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const agendaRailRef = useRef(null);
  const contextRailRef = useRef(null);
  const agendaPassiveSyncSuppressedUntilRef = useRef(0);
  const handledInitialDeadlineCreateRef = useRef(null);
  const handledDashboardDetailFocusRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const eventEditorRef = useRef(null);
  const [monthMotionDirection, setMonthMotionDirection] = useState(0);
  const {
    floatingDetail,
    setFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
    reanchorFloatingDetail,
    closeFloatingDetail,
    parkFloatingDetail,
    setFloatingDetailDragged,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setFloatingEditorDirty,
    setFloatingEditorSaveRequest,
  } = useCalendarFloatingDetail({ open, view, panelRef, railRef: contextRailRef });

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const activeView = VIEWS[view] || billsView;
  const activeLayout = getCalendarLayoutMetrics(viewportWidth);
  const usesFloatingEditor = !activeLayout.stacked;

  const viewData = useMemo(() => {
    if (view === "events") {
      const prevMonth = addMonthOffset(viewYear, viewMonth, -1);
      const nextMonth = addMonthOffset(viewYear, viewMonth, 1);
      const visibleRange = getVisibleGridRange(viewYear, viewMonth);
      const committedOverlayData = deadlineOverlayRecordData(committedDeadlineOverlayData, visibleRange);
      const seededOverlayData = !planningReadiness.deadlinesDelayed
        && (!deadlinesRangeData?.dataRange || rangeMatches(deadlinesRangeData.dataRange, visibleRange))
        ? deadlinesRangeData?.data
        : null;
      const overlayData = committedOverlayData
        || seededOverlayData
        || (!deadlinesRangeData?.ensureRange ? deadlinesData : null);
      const lateRecord = deadlineOverlayRecordData(lateDeadlineOverlayData, visibleRange)
        ? lateDeadlineOverlayData
        : null;
      return {
        events: dedupeEvents([
          ...(eventsData?.getEvents?.(prevMonth.year, prevMonth.month) || []),
          ...(eventsData?.getEvents?.(viewYear, viewMonth) || []),
          ...(eventsData?.getEvents?.(nextMonth.year, nextMonth.month) || []),
        ]),
        deadlineOverlay: {
          enabled: deadlineOverlayVisible,
          showCompleted: completedDeadlineOverlayVisible,
          data: deadlineOverlayVisible ? overlayData : null,
          readiness: planningReadiness,
          onApplyLateDeadlines: lateRecord
            ? () => {
                setCommittedDeadlineOverlayData(lateRecord);
                setLateDeadlineOverlayData(null);
                setPlanningReadiness((current) => ({
                  ...current,
                  state: "ready",
                  deadlinesDelayed: false,
                  lateDeadlinesReady: false,
                }));
              }
            : null,
        },
        isLoading: eventsData?.isMonthLoading?.(prevMonth.year, prevMonth.month)
          || eventsData?.isMonthLoading?.(viewYear, viewMonth)
          || eventsData?.isMonthLoading?.(nextMonth.year, nextMonth.month)
          || false,
        pendingUpdate: !!eventsData?.staleRefreshPending,
        hasMonth: eventsData?.hasMonth?.(viewYear, viewMonth) || false,
      };
    }
    if (view === "deadlines") {
      const rangeData = deadlinesRangeData?.data;
      return {
        ...(rangeData || deadlinesData),
        isLoading: !!deadlinesRangeData?.loading || deadlinesData?.isLoading,
        rangeError: deadlinesRangeData?.error || null,
        ensureRange: deadlinesRangeData?.ensureRange,
      };
    }
    const rangeData = billsRangeData?.data;
    return {
      ...(rangeData || billsData),
      isLoading: !!billsRangeData?.loading || billsData?.isLoading,
      rangeError: billsRangeData?.error || null,
      ensureRange: billsRangeData?.ensureRange,
    };
  }, [
    view,
    eventsData,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    committedDeadlineOverlayData,
    deadlinesRangeData?.ensureRange,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    planningReadiness,
    lateDeadlineOverlayData,
    deadlinesData,
    billsData,
    deadlinesRangeData?.loading,
    deadlinesRangeData?.error,
    billsRangeData?.data,
    billsRangeData?.loading,
    billsRangeData?.error,
    billsRangeData?.ensureRange,
  ]);

  useEffect(() => {
    if (view !== "events" || !deadlineOverlayVisible || !deadlinesRangeData?.data) return;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    if (!rangeMatches(deadlinesRangeData?.dataRange, visibleRange)) return;
    setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(deadlinesRangeData.data, deadlinesRangeData.dataRange));
  }, [
    view,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    deadlinesRangeData?.revision,
  ]);

  function focusEditorDate(ymd) {
    focusDateKey(ymd);
  }

  const suppressAgendaPassiveSync = useCallback((durationMs = 900) => {
    agendaPassiveSyncSuppressedUntilRef.current = Math.max(
      agendaPassiveSyncSuppressedUntilRef.current,
      performance.now() + durationMs,
    );
  }, []);

  const {
    cancelFloatingEditor,
    handleEventEditorDeleted,
    handleEventEditorSaved,
    handleFloatingDeadlineDeleted,
    handleFloatingDeadlineSaved,
    openFloatingDeadlineCreate,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingEventEdit,
  } = useCalendarModalEditorRouting({
    activeSelectedDateKey,
    activeView,
    eventEditorRef,
    findDateCell,
    floatingDetailRef,
    openFloatingDetail,
    selectedDay,
    selectedItemId,
    setDeadlineDraftPreview,
    setDeadlineEditor,
    setFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    suppressAgendaPassiveSync,
    viewMonth,
    viewYear,
  });

  const eventEditor = useCalendarEventEditor({
    open,
    view,
    editable: !!eventsData?.editable,
    selectedDay: activeSelectedDay,
    selectedDate: view === "events" ? activeSelectedDateKey : null,
    viewYear,
    viewMonth,
    refreshRange: eventsData?.refreshRange,
    upsertEvents: eventsData?.upsertEvents,
    removeEvent: eventsData?.removeEvent,
    onFocusDate: focusEditorDate,
    onSaved: handleEventEditorSaved,
    onDeleted: handleEventEditorDeleted,
  });

  const openEventCreate = eventEditor.openCreate;
  const prefetchEventSources = eventEditor.prefetchSources;

  useLayoutEffect(() => {
    eventEditorRef.current = eventEditor;
  }, [eventEditor]);

  const toggleDeadlineOverlay = useCallback(() => {
    setDeadlineOverlayVisible((current) => {
      const next = !current;
      writeStoredBoolean(DEADLINE_OVERLAY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleCompletedDeadlineOverlay = useCallback(() => {
    setCompletedDeadlineOverlayVisible((current) => {
      const next = !current;
      writeStoredBoolean(COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!eventEditor.editable || typeof window === "undefined") return undefined;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchEventSources(), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => prefetchEventSources(), 400);
    return () => window.clearTimeout(id);
  }, [open, view, eventEditor.editable, prefetchEventSources]);

  const closeEventEditor = eventEditor.closeEditor;
  const deadlinesEnsureRange = deadlinesRangeData?.ensureRange;

  useEffect(() => {
    if (!open || view !== "events" || !forceDeadlineOverlay) return;
    setDeadlineOverlayVisible(true);
    writeStoredBoolean(DEADLINE_OVERLAY_STORAGE_KEY, true);
  }, [forceDeadlineOverlay, open, openRequestId, view]);

  const eventQuickActions = useCalendarQuickActions({
    editable: !!eventsData?.editable,
    layout: getCalendarLayoutMetrics(viewportWidth),
    refreshRange: eventsData?.refreshRange,
    upsertEvents: eventsData?.upsertEvents,
    removeEvent: eventsData?.removeEvent,
    onSelectEvent: (itemId, dateKey) => {
      const parsed = parseYmd(dateKey);
      if (parsed) {
        setSelectedDateKey(dateKey);
        setSelectedDay(parsed.day);
      }
      setSelectedItemId(itemId != null ? String(itemId) : null);
      window.requestAnimationFrame(() => {
        agendaRailRef.current?.scrollToEvent?.(itemId, dateKey);
      });
    },
    onEventDeleted: (itemId) => {
      const current = floatingDetailRef.current;
      if (itemId != null && current?.open && current.view === "events" && String(current.itemId) === String(itemId)) {
        setFloatingDetail(null);
      }
      if (itemId != null && String(selectedItemId) === String(itemId)) {
        setSelectedItemId(null);
      }
    },
  });

  const deadlineQuickActions = useDeadlineQuickActions({
    enabled: open && (view === "deadlines" || (view === "events" && deadlineOverlayVisible)),
    actions: deadlineActions,
    onEditTask: (task, options = {}) => {
      if (activeLayout.stacked) {
        const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
        const parsed = parseYmd(dateKey);
        if (parsed) {
          setSelectedDay(parsed.day);
          setSelectedDateKey(dateKey);
        }
        setSelectedItemId(String(task.id));
        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        setDeadlineDraftPreview(null);
        setFloatingDetail(null);
        return;
      }
      openFloatingDeadlineEdit(task, options);
    },
    onDeleted: (taskId) => {
      handleFloatingDeadlineDeleted(taskId);
    },
  });

  const handleViewChange = useCallback((nextView) => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty && nextView !== view) {
      shakeFloatingEditor();
      return;
    }
    if (nextView && nextView !== view) {
      setFloatingDetail(null);
    }
    onViewChange?.(nextView);
  }, [floatingDetailRef, onViewChange, setFloatingDetail, shakeFloatingEditor, view]);

  const closeCalendarModal = useCallback(() => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return;
    }
    setFloatingDetail(null);
    setSuppressFocusRing(false);
    onClose();
  }, [floatingDetailRef, onClose, setFloatingDetail, setSuppressFocusRing, shakeFloatingEditor]);

  function navigateMonth(dir, _options = {}) {
    const currentFloating = floatingDetailRef.current;
    const activeEditorOpen =
      eventEditorRef.current?.isEditorOpen
      || !!deadlineEditor?.mode
      || (
        currentFloating?.open
        && (currentFloating.mode === "edit" || currentFloating.mode === "create")
      );
    const preserveEditor = activeEditorOpen;
    const shouldParkFloatingEditor =
      currentFloating?.open
      && (currentFloating.mode === "edit" || currentFloating.mode === "create");

    if (preserveEditor) {
      setWorkspaceTransientCloseToken((token) => token + 1);
      setManualMonthBrowseKey((key) => key + 1);
    } else {
      setDeadlineDraftPreview(null);
    }
    setMonthMotionDirection(dir > 0 ? 1 : -1);
    if (preserveEditor) {
      if (shouldParkFloatingEditor) {
        parkFloatingDetail();
      }
    } else if (floatingDetail?.open) {
      parkFloatingDetail();
    } else {
      closeEventEditor();
      setSelectedDay(null);
      setSelectedDateKey(null);
      setSelectedItemId(null);
      setDeadlineEditor(null);
    }
    setViewDate((prev) => {
      const next = prev.month + dir;
      if (next > 11) return { month: 0, year: prev.year + 1 };
      if (next < 0) return { month: 11, year: prev.year - 1 };
      return { month: next, year: prev.year };
    });
  }
  useEffect(() => {
    navigateMonthRef.current = navigateMonth;
  });

  function focusDeadlineTask(task) {
    focusDateKey(task?.due_date);
    const itemId = deadlinesView.getItemId(task);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  function selectAgendaDate(dateKey, { passive = false } = {}) {
    if (passive && performance.now() < agendaPassiveSyncSuppressedUntilRef.current) return;
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (passive) return;
      if (current.dirty) {
        shakeFloatingEditor();
        return;
      }
      if (current.view === "events") eventEditor.closeEditor?.();
      if (current.view === "deadlines") {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      }
    } else if (!passive) {
      closeEventEditor();
    }
    setFloatingDetail(null);
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    setSelectedItemId(null);
    if (view === "deadlines") setDeadlineEditor(null);
  }

  function selectAgendaEvent({ event, item, dateKey, anchorElement, sourceCellElement, anchorKind, detailView }) {
    const selectedItem = item || event;
    if (!selectedItem) return;
    suppressAgendaPassiveSync();
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return;
    }
    closeEventEditor();
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(selectedItem) : selectedItem.id;
    setSelectedItemId(itemId != null ? String(itemId) : null);
    openFloatingDetail({
      mode: "detail",
      view: detailView || view,
      itemId,
      dateKey,
      day: parsed.day,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorKind || "agenda-row",
      itemsSnapshot: [selectedItem],
    });
  }

  const requestAgendaScroll = useCallback((command) => {
    if (!command) return;
    suppressAgendaPassiveSync();
    const scrollCommand = {
      ...command,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    setAgendaScrollCommand(scrollCommand);
    window.requestAnimationFrame(() => {
      const rail = agendaRailRef.current;
      if (!rail) return;
      if (scrollCommand.type === "today") {
        rail.scrollToToday?.(scrollCommand.id);
      } else if (scrollCommand.type === "date") {
        rail.scrollToDate?.(scrollCommand.dateKey, scrollCommand.id);
      } else if (scrollCommand.type === "event" || scrollCommand.type === "item") {
        rail.scrollToItem?.(scrollCommand.itemId, scrollCommand.dateKey, scrollCommand.id);
      }
    });
  }, [suppressAgendaPassiveSync]);

  const scrollAgendaToDate = useCallback((dateKey) => {
    requestAgendaScroll({ type: "date", dateKey });
  }, [requestAgendaScroll]);

  const scrollAgendaToEvent = useCallback((itemId, dateKey) => {
    requestAgendaScroll({ type: "event", itemId, dateKey });
  }, [requestAgendaScroll]);

  useEffect(() => {
    const shouldOpenDeadlineCreate = focusItemId === "new" && (
      view === "deadlines"
      || (view === "events" && forceDeadlineOverlay)
    );
    if (!open || !shouldOpenDeadlineCreate || !usesFloatingEditor) return;
    const requestKey = `${openRequestId}:${focusDate || ""}`;
    if (handledInitialDeadlineCreateRef.current === requestKey) return;
    handledInitialDeadlineCreateRef.current = requestKey;
    window.requestAnimationFrame(() => {
      if (!floatingDetailRef.current?.open) {
        openFloatingDeadlineCreate(focusDate || activeSelectedDateKey || todayDateKey, {
          allowSelectionFallback: true,
        });
      }
    });
    // Initial create focus is keyed by the explicit open request, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, focusItemId, openRequestId, focusDate, forceDeadlineOverlay, usesFloatingEditor]);

  const commitSyncSnapshotEffects = useEffectEvent((snapshot) => {
    const createDeadlineSeedDate = focusDate
      || snapshot?.nextSelectedDateKey
      || activeSelectedDateKey
      || todayDateKey;
    if (snapshot?.didViewChange) {
      closeEventEditor();
      setDeadlineDraftPreview(null);
      setFloatingDetail(null);
    }
    if (snapshot?.resetDeadlineEditor) {
      setFloatingDetail(null);
    }
    if (snapshot?.openCreate && view === "events" && forceDeadlineOverlay) {
      if (usesFloatingEditor) {
        openFloatingDeadlineCreate(createDeadlineSeedDate, {
          allowSelectionFallback: true,
        });
      } else {
        setDeadlineEditor({ mode: "create", seedDate: createDeadlineSeedDate });
      }
    } else if (snapshot?.openCreate && view === "events" && eventEditor.editable) {
      if (usesFloatingEditor) {
        openFloatingEventCreate(focusDate || snapshot.nextSelectedDateKey || null);
      } else {
        openEventCreate();
      }
    } else if (snapshot?.openCreate && view === "deadlines") {
      if (usesFloatingEditor) {
        openFloatingDeadlineCreate(focusDate || snapshot.nextSelectedDateKey || null, {
          allowSelectionFallback: !!focusDate || !!snapshot.nextSelectedDateKey,
        });
      } else {
        setDeadlineEditor({ mode: "create", seedDate: focusDate || null });
      }
    } else if (snapshot?.resetDeadlineEditor) {
      setDeadlineEditor(null);
      setDeadlineDraftPreview(null);
    }
    commitSelectionSyncSnapshot(snapshot, { open, view, openRequestId });
  });

  useLayoutEffect(() => {
    commitSyncSnapshotEffects(syncSnapshot);
  }, [syncSnapshot, open, view, openRequestId]);

  const suppressOutsideClick = useCalendarModalOutsideDismiss({
    open,
    panelRef,
    floatingDetail,
    setFloatingDetail,
    closeCalendarModal,
    shakeFloatingEditor,
  });

  useCalendarModalWheelContainment({ open, scrollRef });

  const viewModel = useCalendarModalViewModel({
    open,
    view,
    viewData,
    activeView,
    activeLayout,
    currentYear,
    currentMonth,
    viewYear,
    viewMonth,
    activeSelectedDay,
    activeSelectedDateKey,
    activeSelectedItemId,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    weatherData,
    floatingDetail,
    setMonthMotionDirection,
    setViewDate,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    manualMonthBrowseKey,
  });
  const { canGoPrev, computed, itemsByDay } = viewModel;
  const shellViewData = view === "deadlines"
    ? { ...viewData, pendingUpdate: viewModel.pendingUpdate }
    : viewData;

  useEffect(() => {
    if (!open) {
      setPendingItemDetailFocus(null);
      handledDashboardDetailFocusRef.current = null;
      return;
    }
    if (!focusOpenDetail || !focusItemId || focusItemId === "new" || !usesFloatingEditor) return;
    const dateKey = focusDate || activeSelectedDateKey;
    if (!dateKey) return;
    const itemId = String(focusItemId);
    const requestKey = `${openRequestId}:${view}:${dateKey}:${itemId}`;
    if (handledDashboardDetailFocusRef.current === requestKey) return;
    setPendingItemDetailFocus((current) => {
      if (
        current?.openRequestId === openRequestId
        && current.view === view
        && current.dateKey === dateKey
        && current.itemId === itemId
      ) {
        return current;
      }
      return {
        openRequestId,
        view,
        dateKey,
        itemId,
        requestKey,
        attempts: 0,
      };
    });
  }, [activeSelectedDateKey, focusDate, focusItemId, focusOpenDetail, open, openRequestId, usesFloatingEditor, view]);

  useEffect(() => {
    if (!pendingItemDetailFocus || !open || !usesFloatingEditor) return undefined;
    if (pendingItemDetailFocus.view !== view) return undefined;

    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      setPendingItemDetailFocus(null);
      return undefined;
    }

    const item = resolvePendingFocusItem({
      activeView,
      computed,
      dateKey: pendingItemDetailFocus.dateKey,
      itemId: pendingItemDetailFocus.itemId,
    });
    const resolvedDateKey = itemDueDate(item) || pendingItemDetailFocus.dateKey;
    const resolvedItemId = item
      ? String(activeView.getItemId ? activeView.getItemId(item) : item.id)
      : pendingItemDetailFocus.itemId;

    const retryOrDegrade = () => {
      setPendingItemDetailFocus((latest) => {
        if (
          !latest
          || latest.openRequestId !== pendingItemDetailFocus.openRequestId
          || latest.view !== pendingItemDetailFocus.view
          || latest.dateKey !== pendingItemDetailFocus.dateKey
          || latest.itemId !== pendingItemDetailFocus.itemId
        ) {
          return latest;
        }
        if ((latest.attempts || 0) >= 20) {
          return null;
        }
        return { ...latest, attempts: (latest.attempts || 0) + 1 };
      });
    };

    if (!item) {
      const id = window.setTimeout(retryOrDegrade, 250);
      return () => window.clearTimeout(id);
    }

    const firstRaf = window.requestAnimationFrame(() => {
      suppressAgendaPassiveSync();
      const activated = agendaRailRef.current?.activateItem?.(
        resolvedItemId,
        resolvedDateKey,
      );
      if (!activated) {
        retryOrDegrade();
        return;
      }
      handledDashboardDetailFocusRef.current = pendingItemDetailFocus.requestKey;
      setPendingItemDetailFocus(null);
    });

    return () => {
      window.cancelAnimationFrame(firstRaf);
    };
  }, [
    activeView,
    computed,
    floatingDetailRef,
    open,
    pendingItemDetailFocus,
    shakeFloatingEditor,
    suppressAgendaPassiveSync,
    usesFloatingEditor,
    view,
  ]);

  useCalendarModalHotkeys({
    open,
    canGoPrev,
    currentMonth,
    currentYear,
    todayDate,
    view,
    viewYear,
    viewMonth,
    closeCalendarModal,
    closeEventEditor,
    eventEditor,
    deadlineEditor,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    selectedItemId,
    selectedDay,
    selectedDateKey,
    activeView,
    itemsByDay,
    itemsByDate: computed.itemsByDate,
    setSuppressFocusRing,
    floatingDetail,
    floatingDetailRef,
    setFloatingDetail,
    handleViewChange,
    usesFloatingEditor,
    cancelFloatingEditor,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setViewDate,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    requestAgendaScroll,
    openFloatingEventEdit,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingDeadlineCreate,
    deadlineOverlayVisible,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: (value) => {
      setDeadlineOverlayVisible(value);
      writeStoredBoolean(DEADLINE_OVERLAY_STORAGE_KEY, value);
    },
    navigateMonthRef,
  });

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    onEventsVisibleRangeChange?.({ start, end });
    const runEnsure = () => {
      let canceled = false;
      let eventsDone = false;
      let deadlinesDone = !deadlineOverlayVisible || !deadlinesEnsureRange;
      let deadlinesTimedOut = false;
      const startedAt = performance.now();
      setPlanningReadiness({
        state: deadlineOverlayVisible ? "loading" : "ready",
        slowSource: null,
        deadlinesDelayed: false,
        lateDeadlinesReady: false,
        eventsReadyAt: null,
        deadlinesReadyAt: deadlinesDone ? startedAt : null,
      });
      setLateDeadlineOverlayData(null);

      const softTimer = window.setTimeout(() => {
        if (canceled || !deadlineOverlayVisible) return;
        setPlanningReadiness((current) => ({
          ...current,
          state: "slow",
          slowSource: !eventsDone ? "events" : !deadlinesDone ? "deadlines" : null,
        }));
      }, 2000);
      const hardTimer = window.setTimeout(() => {
        if (canceled || !deadlineOverlayVisible || deadlinesDone || !eventsDone) return;
        deadlinesTimedOut = true;
        setCommittedDeadlineOverlayData(null);
        setPlanningReadiness((current) => ({
          ...current,
          state: "degraded",
          deadlinesDelayed: true,
          lateDeadlinesReady: false,
        }));
      }, 3000);

      const eventsPromise = eventsData.ensureRange(start, end)
        .then(() => {
          eventsDone = true;
          if (canceled) return;
          setPlanningReadiness((current) => ({ ...current, eventsReadyAt: performance.now() }));
        });
      const deadlinesPromise = deadlineOverlayVisible && deadlinesEnsureRange
        ? deadlinesEnsureRange(start, end)
          .then((data) => {
            deadlinesDone = true;
            if (canceled) return;
            if (deadlinesTimedOut) {
              setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => ({
                ...current,
                deadlinesReadyAt: performance.now(),
                lateDeadlinesReady: true,
              }));
              return;
            }
            if (eventsDone) {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setLateDeadlineOverlayData(null);
              setPlanningReadiness((current) => ({
                ...current,
                state: "ready",
                deadlinesDelayed: false,
                lateDeadlinesReady: false,
                deadlinesReadyAt: performance.now(),
              }));
            } else {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => ({ ...current, deadlinesReadyAt: performance.now() }));
            }
          })
        : Promise.resolve(null);

      Promise.allSettled([eventsPromise, deadlinesPromise]).then((results) => {
        if (canceled) return;
        const failed = results.find((result) => result.status === "rejected");
        if (failed) {
          setPlanningReadiness((current) => ({
            ...current,
            state: "error",
            slowSource: null,
          }));
          return;
        }
        if (!deadlineOverlayVisible) return;
        if (deadlinesDone && eventsDone) {
          setPlanningReadiness((current) => ({
            ...current,
            state: "ready",
            deadlinesDelayed: false,
            lateDeadlinesReady: false,
          }));
        }
      });

      deadlinesPromise.then((data) => {
        if (canceled || !deadlineOverlayVisible || !data) return;
        setPlanningReadiness((current) => {
          if (!current.deadlinesDelayed) return current;
          setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
          return { ...current, lateDeadlinesReady: true };
        });
      }).catch(() => {});

      return () => {
        canceled = true;
        window.clearTimeout(softTimer);
        window.clearTimeout(hardTimer);
      };
    };

    if (eventEditor.isEditorOpen) {
      let cleanup = null;
      const id = window.setTimeout(() => {
        cleanup = runEnsure();
      }, 260);
      return () => {
        window.clearTimeout(id);
        cleanup?.();
      };
    }
    return runEnsure();
  }, [open, view, viewYear, viewMonth, eventsData, eventEditor.isEditorOpen, onEventsVisibleRangeChange, deadlineOverlayVisible, deadlinesEnsureRange]);

  const domainEnsureRange = viewData?.ensureRange;
  useEffect(() => {
    if (!open || view === "events" || !domainEnsureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    domainEnsureRange(start, end).catch((err) => {
      console.error(`[Calendar] ${view} range fetch failed:`, err);
    });
  }, [domainEnsureRange, open, view, viewYear, viewMonth]);

  useEffect(() => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "events" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (eventEditor.isEditorOpen) return;
    const id = window.requestAnimationFrame(() => {
      setFloatingDetail((latest) => {
        if (!latest?.open || latest.view !== "events" || (latest.mode !== "edit" && latest.mode !== "create")) return latest;
        return latest.mode === "create"
          ? null
          : {
              ...latest,
              mode: "detail",
              editorSessionId: null,
              saveRequestId: null,
              activeSaveRequestId: null,
              dirty: false,
            };
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [eventEditor.isEditorOpen, floatingDetailRef, setFloatingDetail]);

  if (!open) return null;

  const shellProps = buildCalendarModalShellProps({
    refs: { panelRef, scrollRef, agendaRailRef, contextRailRef },
    viewState: { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, monthMotionDirection, suppressFocusRing, workspaceTransientCloseToken },
    data: { activeView, viewData: shellViewData, weatherData },
    viewModel,
    selection: { activeSelectedDay, activeSelectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId },
    editors: {
      eventEditor: {
        ...eventEditor,
        deadlineOverlay: view === "events"
          ? {
              enabled: deadlineOverlayVisible,
              showCompleted: completedDeadlineOverlayVisible,
              readiness: planningReadiness,
              lateDeadlinesReady: !!lateDeadlineOverlayData,
              onToggle: toggleDeadlineOverlay,
              onToggleCompleted: deadlineOverlayVisible ? toggleCompletedDeadlineOverlay : undefined,
              onApplyLateDeadlines: viewData?.deadlineOverlay?.onApplyLateDeadlines,
            }
          : null,
      },
      deadlineEditor,
      setDeadlineEditor,
      setDeadlineDraftPreview,
    },
    quickActions: { eventQuickActions, deadlineQuickActions },
    agenda: {
      agendaScrollCommand,
      onAgendaPassiveDateChange: (dateKey) => selectAgendaDate(dateKey, { passive: true }),
      onAgendaDateAction: (dateKey) => selectAgendaDate(dateKey),
      onAgendaEventAction: selectAgendaEvent,
      scrollAgendaToDate,
      scrollAgendaToEvent,
    },
    floating: {
      floatingDetail, openFloatingDetail, reanchorFloatingDetail, closeFloatingDetail, parkFloatingDetail, setFloatingDetailDragged,
      openFloatingEventCreate, openFloatingEventEdit, openFloatingDeadlineCreate, openFloatingDeadlineEdit,
      cancelFloatingEditor, setFloatingEditorDirty, setFloatingEditorSaveRequest, shakeFloatingEditor,
      handleFloatingDeadlineSaved, handleFloatingDeadlineDeleted,
    },
    handlers: { navigateMonth, handleViewChange, suppressOutsideClick, closeCalendarModal, closeEventEditor, focusDeadlineTask },
  });

  return (
    <CalendarModalShell {...shellProps} />
  );
}
