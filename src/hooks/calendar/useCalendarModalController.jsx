import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "../../components/calendar/views/billsView.jsx";
import deadlinesView from "../../components/calendar/views/deadlinesView.jsx";
import eventsView from "../../components/calendar/views/eventsView.jsx";
import { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.js";
import useCalendarEventEditor from "../../components/calendar/events/useCalendarEventEditor.js";
import {
  addCalendarEventSelection,
  calendarEventSelectionIdentity,
  calendarEventSelectionSize,
  clearCalendarEventSelection,
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
  getOrderedCalendarEventSelection,
  isCalendarEventSelected,
  resolveCalendarEventActionScope,
  toggleCalendarEventSelection,
} from "../../components/calendar/events/calendarEventSelectionModel.js";
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
import useCalendarModalSearch from "./useCalendarModalSearch.js";
import useCalendarModalSelection from "./useCalendarModalSelection.js";
import useCalendarModalViewModel from "./useCalendarModalViewModel.js";
import useCalendarModalWheelContainment from "./useCalendarModalWheelContainment.js";
import useViewportWidth from "./useViewportWidth.js";
import { activationTargetFromCalendarSearchResult } from "./calendarModalSearchModel.js";
import { floatingDetailOwnsGridSelection } from "./calendarFloatingDetailModel.js";
import { isGoogleSpecialDateEvent } from "../../components/calendar/googleSpecialDateModel.js";
import {
  COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY,
  DEADLINE_OVERLAY_STORAGE_KEY,
  dashboardDetailFocusRequest,
  floatingWorkspaceNavigationEffect,
  initialDeadlineEditorState,
  isDeadlineCreateFocusRequest,
  readStoredBoolean,
  shouldForceDeadlineOverlay,
  writeStoredBoolean,
} from "./calendarModalInteractionModel.js";
import {
  planningDeadlinesReadyState,
  planningDeadlineTimedOutState,
  planningEventsReadyState,
  planningIdleState,
  planningInitialState,
  planningLateDeadlinesReadyState,
  planningSettledState,
  planningSlowState,
} from "./calendarPlanningSessionModel.js";

const VIEWS = {
  events: eventsView,
  bills: billsView,
  deadlines: deadlinesView,
};
const DASHBOARD_DETAIL_FOCUS_RETRY_MS = 250;
const DASHBOARD_DETAIL_FOCUS_MAX_ATTEMPTS = 120;
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

function itemFromCalendarSearchResult(result) {
  if (!result) return null;
  if (result.type === "event") {
    return {
      ...(result.payload || {}),
      id: result.itemId,
      title: result.title,
      agendaDateKey: result.itemDate,
      startMs: result.payload?.startMs,
      endMs: result.payload?.endMs,
      allDay: !!result.payload?.allDay,
      location: result.location || "",
      source: result.sourceLabel || result.meta || "Calendar",
      sourceColor: result.sourceColor,
      color: result.sourceColor,
      time: result.subtitle || "",
    };
  }
  if (result.type === "deadline") {
    return {
      ...(result.payload || {}),
      id: result.itemId,
      title: result.title,
      agendaDateKey: result.itemDate,
      due_date: result.itemDate,
      class_name: result.subtitle || "",
      source: result.payload?.source || result.coverageKey || "todoist",
      status: "open",
    };
  }
  if (result.type === "bill") {
    return {
      ...(result.payload || {}),
      id: result.itemId,
      name: result.title,
      title: result.title,
      agendaDateKey: result.itemDate,
      next_date: result.itemDate,
      payee: result.subtitle || "",
    };
  }
  return {
    id: result.itemId || result.id,
    title: result.title,
    agendaDateKey: result.itemDate,
  };
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

function hasDeadlineItemsInRange(data, range) {
  if (!data || !range) return false;
  for (const sectionName of ["ctm", "todoist"]) {
    for (const item of data?.[sectionName]?.upcoming || []) {
      const dueDate = item?.agendaDateKey || item?.due_date || item?.dueDate || item?.date;
      if (dueDate && dueDate >= range.start && dueDate <= range.end) return true;
    }
  }
  return false;
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

function itemMatchesViewId(activeView, item, itemId) {
  if (!item || itemId == null) return false;
  const id = String(itemId);
  const getItemId = activeView?.getItemId || ((candidate) => candidate?.id);
  return activeView?.matchesItemId?.(item, id)
    || String(getItemId(item)) === id
    || String(item?.id) === id;
}

function findItemLocation(activeView, computed, itemId, preferredDateKey = null) {
  if (itemId == null) return null;
  const matchInPool = (dateKey, pool) => {
    const item = itemsFromDatePool(activeView, pool)
      .find((candidate) => itemMatchesViewId(activeView, candidate, itemId));
    return item ? { dateKey, item } : null;
  };
  if (preferredDateKey) {
    const preferred = matchInPool(preferredDateKey, computed?.itemsByDate?.[preferredDateKey]);
    if (preferred) return preferred;
  }
  for (const [dateKey, pool] of Object.entries(computed?.itemsByDate || {})) {
    const location = matchInPool(dateKey, pool);
    if (location) return location;
  }
  return null;
}

function findGridChipAnchor(panelElement, itemId, dateKey) {
  if (!panelElement || itemId == null || !dateKey) return null;
  const id = String(itemId);
  return [
    ...panelElement.querySelectorAll(
      "[data-testid='calendar-cell-item-chip'], [data-testid='calendar-event-span-segment']",
    ),
  ].find((element) => {
    if (String(element.getAttribute("data-item-id")) !== id) return false;
    const cell = element.closest?.("[role='gridcell']");
    return cell?.getAttribute("data-date-key") === dateKey;
  }) || null;
}

function searchResultIsCompletedDeadline(result) {
  if (result?.type !== "deadline") return false;
  const status = String(result?.status || result?.payload?.status || result?.activation?.status || "").toLowerCase();
  if (status) return status === "complete" || status === "completed" || status === "done";
  return /\bcomplete(?:d)?\b/i.test(String(result?.subtitle || ""));
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
  forceEventOverlay = false,
  forceDeadlineOverlay = false,
  forceCompletedDeadlineOverlay = false,
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
  const isInitialDeadlineCreateRequest = isDeadlineCreateFocusRequest({
    open,
    view,
    focusItemId,
    forceDeadlineOverlay,
  });
  const [deadlineEditor, setDeadlineEditor] = useState(() => initialDeadlineEditorState({
    open,
    view,
    focusItemId,
    focusDate,
    forceDeadlineOverlay,
    todayDateKey,
  }));
  const viewportWidth = useViewportWidth();
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState(null);
  const [eventOverlayVisible, setEventOverlayVisible] = useState(true);
  const [deadlineOverlayVisible, setDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(typeof window === "undefined" ? null : window.localStorage, DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [completedDeadlineOverlayVisible, setCompletedDeadlineOverlayVisible] = useState(() => (
    readStoredBoolean(typeof window === "undefined" ? null : window.localStorage, COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, true)
  ));
  const [committedDeadlineOverlayData, setCommittedDeadlineOverlayData] = useState(null);
  const [lateDeadlineOverlayData, setLateDeadlineOverlayData] = useState(null);
  const [planningReadiness, setPlanningReadiness] = useState(planningIdleState);
  const [manualMonthBrowseKey, setManualMonthBrowseKey] = useState(0);
  const [workspaceTransientCloseToken, setWorkspaceTransientCloseToken] = useState(0);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [agendaScrollCommand, setAgendaScrollCommand] = useState(null);
  const [agendaEntryScrollReleased, setAgendaEntryScrollReleased] = useState(false);
  const [pendingItemDetailFocus, setPendingItemDetailFocus] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const agendaRailRef = useRef(null);
  const contextRailRef = useRef(null);
  const agendaPassiveSyncSuppressedUntilRef = useRef(0);
  const handledInitialDeadlineCreateRef = useRef(null);
  const handledDashboardDetailFocusRef = useRef(null);
  const forcedVisibilityRef = useRef(null);
  const overlayVisibilityRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const eventEditorRef = useRef(null);
  const agendaSelectionAnchorRef = useRef(null);
  const searchActivationSeqRef = useRef(0);
  const searchResultGridNavigableRef = useRef(() => true);
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
  const agendaEntryTargetDateKey = useMemo(() => {
    if (!open) return null;
    if (focusDate && parseYmd(focusDate)) return focusDate;
    if (isInitialDeadlineCreateRequest && view === "deadlines") return null;
    return todayDateKey;
  }, [focusDate, isInitialDeadlineCreateRequest, open, todayDateKey, view]);
  const effectiveAgendaEntryTargetDateKey = agendaEntryScrollReleased ? false : agendaEntryTargetDateKey;
  const eventsEnsureRange = eventsData?.ensureRange || null;
  const eventsRefreshRange = eventsData?.refreshRange || null;
  const eventsUpsertEvents = eventsData?.upsertEvents || null;
  const eventsRemoveEvent = eventsData?.removeEvent || null;
  const eventsGetEvents = eventsData?.getEvents || null;
  const eventsHasMonth = eventsData?.hasMonth || null;
  const eventsIsMonthLoading = eventsData?.isMonthLoading || null;
  const eventsEditable = !!eventsData?.editable;
  const eventsLoading = !!eventsData?.loading;
  const eventsStaleRefreshPending = !!eventsData?.staleRefreshPending;
  const eventsRevision = eventsData?.revision;
  const [calendarEventClipboard, setCalendarEventClipboard] = useState(null);
  const [calendarEventSelectionSet, setCalendarEventSelectionSet] = useState(() => createCalendarEventSelectionSet());
  const calendarEventSelectionRef = useRef(calendarEventSelectionSet);
  useEffect(() => {
    calendarEventSelectionRef.current = calendarEventSelectionSet;
  }, [calendarEventSelectionSet]);
  const calendarEventSelectionCount = calendarEventSelectionSize(calendarEventSelectionSet);
  const clearCalendarEventSelectionSet = useCallback(() => {
    setCalendarEventSelectionSet((current) => (
      calendarEventSelectionSize(current) > 0 ? clearCalendarEventSelection() : current
    ));
  }, []);

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
      const currentOverlayData = !planningReadiness.deadlinesDelayed ? deadlinesData : null;
      const hasResolvedDeadlineRange = !!committedOverlayData
        || !!(seededOverlayData && deadlinesRangeData?.dataRange && rangeMatches(deadlinesRangeData.dataRange, visibleRange));
      const hasVisibleDeadlineSeed = hasDeadlineItemsInRange(seededOverlayData, visibleRange)
        || hasDeadlineItemsInRange(currentOverlayData, visibleRange);
      const eventsRangeLoading = eventsLoading
        || !!eventsIsMonthLoading?.(prevMonth.year, prevMonth.month)
        || !!eventsIsMonthLoading?.(viewYear, viewMonth)
        || !!eventsIsMonthLoading?.(nextMonth.year, nextMonth.month);
      const awaitingDeadlineOverlay = deadlineOverlayVisible
        && !!deadlinesRangeData?.ensureRange
        && ["idle", "loading", "slow"].includes(planningReadiness.state)
        && !hasResolvedDeadlineRange
        && !hasVisibleDeadlineSeed;
      const eventsEntryReady = !eventsEnsureRange || !!planningReadiness.eventsReadyAt;
      const deadlinesEntryReady = !deadlineOverlayVisible
        || !deadlinesRangeData?.ensureRange
        || !!planningReadiness.deadlinesReadyAt
        || !!planningReadiness.deadlinesDelayed;
      const agendaEntryReady = eventsEntryReady && deadlinesEntryReady && !awaitingDeadlineOverlay;
      const overlayData = committedOverlayData
        || seededOverlayData
        || currentOverlayData;
      const lateRecord = deadlineOverlayRecordData(lateDeadlineOverlayData, visibleRange)
        ? lateDeadlineOverlayData
        : null;
      return {
        events: awaitingDeadlineOverlay || !eventOverlayVisible
          ? []
          : dedupeEvents([
              ...(eventsGetEvents?.(prevMonth.year, prevMonth.month) || []),
              ...(eventsGetEvents?.(viewYear, viewMonth) || []),
              ...(eventsGetEvents?.(nextMonth.year, nextMonth.month) || []),
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
        isLoading: eventsRangeLoading
          || awaitingDeadlineOverlay
          || false,
        agendaEntryReady,
        pendingUpdate: eventsStaleRefreshPending,
        hasMonth: eventsHasMonth?.(viewYear, viewMonth) || false,
        revision: eventsRevision,
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
    const activeBillsData = rangeData || billsData;
    const visibleBillsCount = (activeBillsData?.schedules || activeBillsData?.allSchedules || []).length;
    return {
      ...activeBillsData,
      isLoading: !!billsRangeData?.loading || billsData?.isLoading,
      pendingUpdate: !!visibleBillsCount && (!!billsRangeData?.loading || !!billsData?.pendingUpdate || !!rangeData?.pendingUpdate),
      rangeError: billsRangeData?.error || null,
      ensureRange: billsRangeData?.ensureRange,
      revision: billsRangeData?.revision,
    };
  }, [
    view,
    eventsEnsureRange,
    eventsGetEvents,
    eventsHasMonth,
    eventsIsMonthLoading,
    eventsLoading,
    eventsStaleRefreshPending,
    eventsRevision,
    viewYear,
    viewMonth,
    eventOverlayVisible,
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
    billsRangeData?.revision,
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
    editable: eventsEditable,
    selectedDay: activeSelectedDay,
    selectedDate: view === "events" ? activeSelectedDateKey : null,
    viewYear,
    viewMonth,
    refreshRange: eventsRefreshRange,
    upsertEvents: eventsUpsertEvents,
    removeEvent: eventsRemoveEvent,
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
      writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, DEADLINE_OVERLAY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleEventOverlay = useCallback(() => {
    setEventOverlayVisible((current) => !current);
  }, []);

  const toggleCompletedDeadlineOverlay = useCallback(() => {
    setCompletedDeadlineOverlayVisible((current) => {
      const next = !current;
      writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, next);
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
  const searchTargetVisibleInCurrentGrid = useCallback((dateKey) => {
    const range = getVisibleGridRange(viewYear, viewMonth);
    return !!dateKey && dateKey >= range.start && dateKey <= range.end;
  }, [viewMonth, viewYear]);

  const activateCalendarSearchResult = useCallback((result, activationContext = null) => {
    const target = activationTargetFromCalendarSearchResult(result);
    const parsed = parseYmd(target?.dateKey);
    if (!target || !parsed) return false;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return false;
    }
    if (eventEditor.isEditorOpen && eventEditor.isDirty) {
      shakeFloatingEditor();
      return false;
    }

    const targetView = target.view === "bills" ? "bills" : "events";
    if (targetView !== view) onViewChange?.(targetView);
    if (target.detailView === "deadlines" && activationContext?.anchorKind !== "grid-chip") {
      setDeadlineOverlayVisible(true);
      if (searchResultIsCompletedDeadline(result)) setCompletedDeadlineOverlayVisible(true);
      writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, DEADLINE_OVERLAY_STORAGE_KEY, true);
    }
    closeEventEditor();
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(target.dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
    }
    setSelectedDay(parsed.day);
    setSelectedDateKey(target.dateKey);
    setSelectedItemId(target.itemId);
    searchActivationSeqRef.current += 1;
    const requestKey = `search:${searchActivationSeqRef.current}:${targetView}:${target.dateKey}:${target.itemId}`;
    setPendingItemDetailFocus({
      openRequestId: searchActivationSeqRef.current,
      view: targetView,
      detailView: target.detailView || targetView,
      dateKey: target.dateKey,
      itemId: target.itemId,
      requestKey,
      attempts: 0,
      anchorElement: activationContext?.anchorElement || null,
      sourceCellElement: activationContext?.sourceCellElement || activationContext?.anchorElement || null,
      anchorKind: activationContext?.anchorKind || "search-result-row",
      searchResult: result,
    });
    return true;
  }, [
    closeEventEditor,
    eventEditor.isDirty,
    eventEditor.isEditorOpen,
    floatingDetailRef,
    onViewChange,
    setFloatingDetail,
    setDeadlineDraftPreview,
    setDeadlineEditor,
    setDeadlineOverlayVisible,
    searchTargetVisibleInCurrentGrid,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    setViewDate,
    shakeFloatingEditor,
    view,
  ]);

  const isCalendarSearchResultGridNavigable = useCallback((...args) => (
    searchResultGridNavigableRef.current?.(...args) ?? true
  ), []);

  const activateCalendarSearchDateHeader = useCallback((dateKey) => {
    const parsed = parseYmd(dateKey);
    if (!parsed) return false;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (current.dirty) {
        shakeFloatingEditor();
        return false;
      }
      if (current.view === "events") eventEditor.closeEditor?.();
      if (current.view === "deadlines") {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      }
    } else {
      closeEventEditor();
    }
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
    }
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    setSelectedItemId(null);
    return true;
  }, [
    closeEventEditor,
    eventEditor,
    floatingDetailRef,
    setDeadlineDraftPreview,
    setDeadlineEditor,
    setFloatingDetail,
    searchTargetVisibleInCurrentGrid,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    setViewDate,
    shakeFloatingEditor,
  ]);

  const calendarSearch = useCalendarModalSearch({
    modalOpen: open,
    view,
    onActivateResult: activateCalendarSearchResult,
  });

  useEffect(() => {
    overlayVisibilityRef.current = {
      eventOverlayVisible,
      deadlineOverlayVisible,
      completedDeadlineOverlayVisible,
    };
  }, [completedDeadlineOverlayVisible, deadlineOverlayVisible, eventOverlayVisible]);

  const resolveSelectedCalendarEvent = useCallback(() => {
    if (view !== "events" || activeSelectedItemId == null) return null;
    const events = viewData?.events || [];
    const selected = events.find((event) => {
      const itemId = activeView.getItemId ? activeView.getItemId(event) : event.id;
      return String(itemId) === String(activeSelectedItemId);
    });
    if (!selected?.startMs || !selected?.calendarId || !selected?.accountId) return null;
    return selected;
  }, [activeSelectedItemId, activeView, view, viewData?.events]);

  const copyCalendarEvent = useCallback((event) => {
    const clipboard = createCalendarEventClipboard(event);
    if (!clipboard) return false;
    setCalendarEventClipboard(clipboard);
    setFloatingDetail(null);
    return true;
  }, [setFloatingDetail]);

  const copySelectedCalendarEvent = useCallback(() => {
    const selectionClipboard = createCalendarEventClipboard(calendarEventSelectionRef.current);
    if (selectionClipboard) {
      setCalendarEventClipboard(selectionClipboard);
      setFloatingDetail(null);
      return true;
    }
    return copyCalendarEvent(resolveSelectedCalendarEvent());
  }, [copyCalendarEvent, resolveSelectedCalendarEvent, setFloatingDetail]);

  const addSelectedCalendarEventToSelectionSet = useCallback(() => {
    const selectedEvent = resolveSelectedCalendarEvent();
    if (!calendarEventSelectionIdentity(selectedEvent)) {
      return isGoogleSpecialDateEvent(selectedEvent) ? "ignored" : false;
    }
    closeEventEditor();
    setFloatingDetail(null);
    setSelectedItemId(null);
    setCalendarEventSelectionSet((selection) => addCalendarEventSelection(selection, selectedEvent));
    return true;
  }, [
    closeEventEditor,
    resolveSelectedCalendarEvent,
    setFloatingDetail,
    setSelectedItemId,
  ]);

  useEffect(() => {
    if (!shouldForceDeadlineOverlay({ open, view, forceDeadlineOverlay })) return;
    setDeadlineOverlayVisible(true);
  }, [forceDeadlineOverlay, open, openRequestId, view]);

  useEffect(() => {
    if (!open || view !== "events") return;
    if (!forceEventOverlay && !forceDeadlineOverlay && !forceCompletedDeadlineOverlay) return;
    const requestKey = [
      openRequestId,
      view,
      forceEventOverlay ? "events" : "",
      forceDeadlineOverlay ? "deadlines" : "",
      forceCompletedDeadlineOverlay ? "completed" : "",
    ].join(":");
    if (forcedVisibilityRef.current?.requestKey === requestKey) return;
    if (forcedVisibilityRef.current) {
      forcedVisibilityRef.current.requestKey = requestKey;
      if (forceEventOverlay) setEventOverlayVisible(true);
      if (forceDeadlineOverlay) setDeadlineOverlayVisible(true);
      if (forceCompletedDeadlineOverlay) setCompletedDeadlineOverlayVisible(true);
      return;
    }
    const current = overlayVisibilityRef.current || {
      eventOverlayVisible,
      deadlineOverlayVisible,
      completedDeadlineOverlayVisible,
    };
    forcedVisibilityRef.current = {
      requestKey,
      previous: {
        ...current,
        storedDeadlineOverlayVisible: readStoredBoolean(
          typeof window === "undefined" ? null : window.localStorage,
          DEADLINE_OVERLAY_STORAGE_KEY,
          current.deadlineOverlayVisible,
        ),
        storedCompletedDeadlineOverlayVisible: readStoredBoolean(
          typeof window === "undefined" ? null : window.localStorage,
          COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY,
          current.completedDeadlineOverlayVisible,
        ),
      },
    };
    if (forceEventOverlay) setEventOverlayVisible(true);
    if (forceDeadlineOverlay) setDeadlineOverlayVisible(true);
    if (forceCompletedDeadlineOverlay) setCompletedDeadlineOverlayVisible(true);
  // Capture the prior visibility exactly once for each dashboard-originated open request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceCompletedDeadlineOverlay, forceDeadlineOverlay, forceEventOverlay, open, openRequestId, view]);

  useEffect(() => {
    if (open || !forcedVisibilityRef.current) return;
    const previous = forcedVisibilityRef.current.previous;
    forcedVisibilityRef.current = null;
    setEventOverlayVisible(previous.eventOverlayVisible);
    setDeadlineOverlayVisible(previous.deadlineOverlayVisible);
    setCompletedDeadlineOverlayVisible(previous.completedDeadlineOverlayVisible);
    writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, DEADLINE_OVERLAY_STORAGE_KEY, previous.storedDeadlineOverlayVisible);
    writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, COMPLETED_DEADLINE_OVERLAY_STORAGE_KEY, previous.storedCompletedDeadlineOverlayVisible);
  }, [open]);

  const resolveContextEventActionScope = useCallback((event) => (
    resolveCalendarEventActionScope(calendarEventSelectionSet, event)
  ), [calendarEventSelectionSet]);

  const baseEventQuickActions = useCalendarQuickActions({
    editable: eventsEditable,
    layout: activeLayout,
    refreshRange: eventsRefreshRange,
    upsertEvents: eventsUpsertEvents,
    removeEvent: eventsRemoveEvent,
    onCopyEvent: copyCalendarEvent,
    onBatchDeleted: clearCalendarEventSelectionSet,
    resolveEventActionScope: resolveContextEventActionScope,
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

  const toggleCalendarEventSelectionSet = useCallback(({ event } = {}) => {
    if (view !== "events") return false;
    const eventIdentity = calendarEventSelectionIdentity(event);
    if (!eventIdentity) return false;
    const selectedEvent = resolveSelectedCalendarEvent();
    const selectedIdentity = calendarEventSelectionIdentity(selectedEvent);
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return true;
    }
    closeEventEditor();
    setFloatingDetail(null);
    setSelectedItemId(null);
    setCalendarEventSelectionSet((selection) => {
      const seededSelection = calendarEventSelectionSize(selection) === 0
        && selectedIdentity
        && selectedIdentity !== eventIdentity
        ? addCalendarEventSelection(selection, selectedEvent)
        : selection;
      return toggleCalendarEventSelection(seededSelection, event);
    });
    return true;
  }, [
    closeEventEditor,
    floatingDetailRef,
    resolveSelectedCalendarEvent,
    setFloatingDetail,
    setSelectedItemId,
    shakeFloatingEditor,
    view,
  ]);

  const eventQuickActions = useMemo(() => ({
    ...baseEventQuickActions,
    eventSelectionActive: calendarEventSelectionCount > 0,
    eventSelectionCount: calendarEventSelectionCount,
    clearEventSelection: clearCalendarEventSelectionSet,
    isEventSelectionSelected: (event) => isCalendarEventSelected(calendarEventSelectionSet, event),
    toggleEventSelection: toggleCalendarEventSelectionSet,
  }), [
    baseEventQuickActions,
    calendarEventSelectionCount,
    calendarEventSelectionSet,
    clearCalendarEventSelectionSet,
    toggleCalendarEventSelectionSet,
  ]);

  const requestSelectedCalendarEventDelete = useCallback(() => {
    const events = getOrderedCalendarEventSelection(calendarEventSelectionRef.current);
    if (!events.length) return false;
    return !!eventQuickActions.requestBatchDelete?.({ events });
  }, [eventQuickActions]);

  const pasteCopiedCalendarEvent = useCallback(() => {
    if (!calendarEventClipboard || !activeSelectedDateKey) return;
    const pasteResult = eventQuickActions.pasteEvent?.(calendarEventClipboard, activeSelectedDateKey);
    if (pasteResult) clearCalendarEventSelectionSet();
  }, [
    activeSelectedDateKey,
    calendarEventClipboard,
    clearCalendarEventSelectionSet,
    eventQuickActions,
  ]);

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
    const workspaceEffect = floatingWorkspaceNavigationEffect({
      currentFloating,
      eventEditorOpen: eventEditorRef.current?.isEditorOpen,
      deadlineEditorMode: deadlineEditor?.mode,
    });

    if (workspaceEffect.preserveEditor) {
      setWorkspaceTransientCloseToken((token) => token + 1);
      setManualMonthBrowseKey((key) => key + 1);
    } else {
      setDeadlineDraftPreview(null);
    }
    setMonthMotionDirection(dir > 0 ? 1 : -1);
    if (workspaceEffect.preserveEditor) {
      if (workspaceEffect.shouldParkFloatingEditor) {
        parkFloatingDetail();
      }
    } else if (workspaceEffect.shouldParkFloatingDetail) {
      parkFloatingDetail();
    } else if (workspaceEffect.shouldClearSelection) {
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
    if (passive && floatingDetailOwnsGridSelection(current)) return;
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
    if (!passive) setFloatingDetail(null);
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    setSelectedItemId(null);
    if (!passive) {
      setAgendaEntryScrollReleased(true);
      agendaSelectionAnchorRef.current = null;
      clearCalendarEventSelectionSet();
    }
    if (view === "deadlines") setDeadlineEditor(null);
  }

  function selectAgendaEvent({ event, item, dateKey, anchorElement, sourceCellElement, anchorKind, detailView, preserveEventSelection = false }) {
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
    if (!preserveEventSelection) clearCalendarEventSelectionSet();
    setAgendaEntryScrollReleased(true);
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(selectedItem) : selectedItem.id;
    setSelectedItemId(itemId != null ? String(itemId) : null);
    agendaSelectionAnchorRef.current = {
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      anchorKind: anchorKind || "agenda-row",
    };
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
    setAgendaEntryScrollReleased(true);
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

  useEffect(() => {
    setAgendaEntryScrollReleased(false);
  }, [agendaEntryTargetDateKey, openRequestId, view]);

  useEffect(() => {
    if (open) return;
    setAgendaScrollCommand(null);
  }, [open]);

  const scrollAgendaToDate = useCallback((dateKey) => {
    agendaSelectionAnchorRef.current = null;
    requestAgendaScroll({ type: "date", dateKey });
  }, [requestAgendaScroll]);

  const scrollAgendaToEvent = useCallback((itemId, dateKey) => {
    agendaSelectionAnchorRef.current = null;
    requestAgendaScroll({ type: "event", itemId, dateKey });
  }, [requestAgendaScroll]);

  const resolveSelectedAgendaEditAnchor = useCallback((itemId, dateKey) => {
    const lastAgendaSelection = agendaSelectionAnchorRef.current;
    if (
      !lastAgendaSelection
      || String(lastAgendaSelection.itemId || "") !== String(itemId || "")
      || lastAgendaSelection.dateKey !== dateKey
      || !String(lastAgendaSelection.anchorKind || "").startsWith("agenda")
    ) {
      return null;
    }
    const anchor = agendaRailRef.current?.getItemAnchor?.(itemId, dateKey);
    if (!anchor) return null;
    return {
      anchorElement: anchor,
      sourceCellElement: anchor,
      anchorKind: lastAgendaSelection.anchorKind,
    };
  }, []);

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
    if (snapshot) {
      setAgendaScrollCommand(null);
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

  const getCalendarSearchResultActivationContext = useCallback((result, _index, fallbackContext = {}) => {
    const target = activationTargetFromCalendarSearchResult(result);
    const parsed = parseYmd(target?.dateKey);
    if (!target || !parsed) {
      return {
        anchorKind: "search-result-row",
        anchorElement: fallbackContext.anchorElement || null,
        sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement || null,
      };
    }
    const targetView = target.view === "bills" ? "bills" : "events";
    const fallbackRowContext = fallbackContext.anchorElement
      ? {
          anchorKind: "search-result-row",
          anchorElement: fallbackContext.anchorElement,
          sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement,
        }
      : null;
    if (targetView !== view || !searchTargetVisibleInCurrentGrid(target.dateKey)) {
      if (fallbackRowContext && (result?.type === "event" || result?.type === "deadline")) return fallbackRowContext;
      return { anchorKind: "grid-chip" };
    }
    const location = findItemLocation(activeView, computed, target.itemId, target.dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(location?.item) : location?.item?.id;
    const gridAnchor = findGridChipAnchor(panelRef.current, itemId ?? target.itemId, location?.dateKey || target.dateKey);
    if (gridAnchor) return { anchorKind: "grid-chip" };
    return {
      anchorKind: "search-result-row",
      anchorElement: fallbackContext.anchorElement || null,
      sourceCellElement: fallbackContext.sourceCellElement || fallbackContext.anchorElement || null,
    };
  }, [
    activeView,
    computed,
    searchTargetVisibleInCurrentGrid,
    view,
  ]);

  useLayoutEffect(() => {
    searchResultGridNavigableRef.current = (result) => {
      const target = activationTargetFromCalendarSearchResult(result);
      const parsed = parseYmd(target?.dateKey);
      if (!target || !parsed) return false;
      const targetView = target.view === "bills" ? "bills" : "events";
      if (targetView !== view) return true;
      if (target.detailView === "events" && !eventOverlayVisible) return false;
      if (target.detailView === "deadlines") return true;
      if (!searchTargetVisibleInCurrentGrid(target.dateKey)) return true;
      const location = findItemLocation(activeView, computed, target.itemId, target.dateKey);
      if (location) return true;
      return result?.type === "event" || result?.type === "deadline";
    };
  }, [
    activeView,
    completedDeadlineOverlayVisible,
    computed,
    deadlineOverlayVisible,
    eventOverlayVisible,
    searchTargetVisibleInCurrentGrid,
    view,
  ]);

  useLayoutEffect(() => {
    if (!open || view !== "bills" || !activeSelectedItemId || !activeSelectedDateKey) return;
    const currentLocation = findItemLocation(
      activeView,
      computed,
      activeSelectedItemId,
      activeSelectedDateKey,
    );
    if (currentLocation?.dateKey === activeSelectedDateKey) return;
    const nextLocation = findItemLocation(activeView, computed, activeSelectedItemId);
    const parsed = parseYmd(nextLocation?.dateKey);
    if (!nextLocation || !parsed) return;
    setSelectedDateKey(nextLocation.dateKey);
    setSelectedDay(parsed.day);
    setSelectedItemId(String(activeSelectedItemId));
    setFloatingDetail((current) => {
      if (
        !current?.open
        || current.view !== "bills"
        || !itemMatchesViewId(activeView, nextLocation.item, current.itemId)
      ) {
        return current;
      }
      return {
        ...current,
        itemId: String(activeSelectedItemId),
        dateKey: nextLocation.dateKey,
        day: parsed.day,
        itemsSnapshot: [nextLocation.item],
      };
    });
  }, [
    activeSelectedDateKey,
    activeSelectedItemId,
    activeView,
    computed,
    open,
    setFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    view,
  ]);

  useLayoutEffect(() => {
    if (!open || !usesFloatingEditor || !floatingDetail?.open || floatingDetail.parked) return;
    if (!String(floatingDetail.anchorKind || "").startsWith("agenda")) return;
    const dateKey = floatingDetail.dateKey || activeSelectedDateKey;
    const itemId = floatingDetail.itemId || activeSelectedItemId;
    const anchor = agendaRailRef.current?.getItemAnchor?.(itemId, dateKey);
    if (!anchor || anchor === floatingDetail.anchorElement) return;
    reanchorFloatingDetail({
      itemId,
      dateKey,
      anchorElement: anchor,
      sourceCellElement: anchor,
      anchorKind: floatingDetail.anchorKind,
    });
  }, [
    activeSelectedDateKey,
    activeSelectedItemId,
    computed,
    floatingDetail,
    open,
    reanchorFloatingDetail,
    usesFloatingEditor,
  ]);

  useLayoutEffect(() => {
    if (
      !open
      || !usesFloatingEditor
      || !floatingDetail?.open
      || floatingDetail.parked
      || floatingDetail.userDragged
    ) {
      return;
    }
    if (String(floatingDetail.anchorKind || "").startsWith("agenda")) return;
    if (String(floatingDetail.anchorKind || "").startsWith("search")) return;
    const dateKey = floatingDetail.dateKey || activeSelectedDateKey;
    const itemId = floatingDetail.itemId || activeSelectedItemId;
    const anchor = findGridChipAnchor(panelRef.current, itemId, dateKey);
    if (!anchor || anchor === floatingDetail.anchorElement) return;
    reanchorFloatingDetail({
      itemId,
      dateKey,
      anchorElement: anchor,
      sourceCellElement: anchor.closest?.("[role='gridcell']") || null,
      anchorKind: floatingDetail.anchorKind || "chip",
    });
  }, [
    activeSelectedDateKey,
    activeSelectedItemId,
    computed,
    floatingDetail,
    open,
    reanchorFloatingDetail,
    usesFloatingEditor,
  ]);

  const shellViewData = view === "deadlines"
    ? { ...viewData, pendingUpdate: viewModel.pendingUpdate }
    : viewData;

  useEffect(() => {
    const request = dashboardDetailFocusRequest({
      open,
      focusOpenDetail,
      focusItemId,
      focusDate,
      activeSelectedDateKey,
      openRequestId,
      usesFloatingEditor,
      view,
    });
    if (!request) {
      if (!open) {
        setPendingItemDetailFocus(null);
        handledDashboardDetailFocusRef.current = null;
      }
      return;
    }
    if (handledDashboardDetailFocusRef.current === request.requestKey) return;
    setPendingItemDetailFocus((current) => {
      if (
        current?.openRequestId === request.openRequestId
        && current.view === request.view
        && current.dateKey === request.dateKey
        && current.itemId === request.itemId
      ) {
        return current;
      }
      return request;
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

    const resolvedItem = resolvePendingFocusItem({
      activeView,
      computed,
      dateKey: pendingItemDetailFocus.dateKey,
      itemId: pendingItemDetailFocus.itemId,
    });
    const item = resolvedItem || (
      pendingItemDetailFocus.anchorKind === "search-result-row"
        ? itemFromCalendarSearchResult(pendingItemDetailFocus.searchResult)
        : null
    );
    const resolvedDateKey = itemDueDate(item) || pendingItemDetailFocus.dateKey;
    const resolvedItemId = item
      ? String(activeView.getItemId ? activeView.getItemId(item) : item.id)
      : pendingItemDetailFocus.itemId;

    let retryTimeout = 0;
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
        if ((latest.attempts || 0) >= DASHBOARD_DETAIL_FOCUS_MAX_ATTEMPTS) {
          return null;
        }
        return { ...latest, attempts: (latest.attempts || 0) + 1 };
      });
    };

    if (!item) {
      retryTimeout = window.setTimeout(retryOrDegrade, DASHBOARD_DETAIL_FOCUS_RETRY_MS);
      return () => window.clearTimeout(retryTimeout);
    }

    if (pendingItemDetailFocus.anchorKind === "grid-chip") {
      const anchorElement = findGridChipAnchor(panelRef.current, resolvedItemId, resolvedDateKey);
      if (!anchorElement) {
        retryTimeout = window.setTimeout(retryOrDegrade, DASHBOARD_DETAIL_FOCUS_RETRY_MS);
        return () => window.clearTimeout(retryTimeout);
      }
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return undefined;
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: pendingItemDetailFocus.detailView || pendingItemDetailFocus.view,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: anchorElement.closest?.("[role='gridcell']") || null,
        anchorKind: "chip",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = pendingItemDetailFocus.requestKey;
      setPendingItemDetailFocus(null);
      return undefined;
    }

    if (pendingItemDetailFocus.anchorKind === "search-result-row") {
      const anchorElement = pendingItemDetailFocus.anchorElement?.isConnected
        ? pendingItemDetailFocus.anchorElement
        : null;
      if (!anchorElement) {
        retryTimeout = window.setTimeout(retryOrDegrade, DASHBOARD_DETAIL_FOCUS_RETRY_MS);
        return () => window.clearTimeout(retryTimeout);
      }
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return undefined;
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: pendingItemDetailFocus.detailView || pendingItemDetailFocus.view,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: pendingItemDetailFocus.sourceCellElement?.isConnected
          ? pendingItemDetailFocus.sourceCellElement
          : anchorElement,
        anchorKind: "search-result-row",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = pendingItemDetailFocus.requestKey;
      setPendingItemDetailFocus(null);
      return undefined;
    }

    const firstRaf = window.requestAnimationFrame(() => {
      suppressAgendaPassiveSync();
      const activated = agendaRailRef.current?.activateItem?.(
        resolvedItemId,
        resolvedDateKey,
      );
      if (!activated) {
        retryTimeout = window.setTimeout(retryOrDegrade, DASHBOARD_DETAIL_FOCUS_RETRY_MS);
        return;
      }
      handledDashboardDetailFocusRef.current = pendingItemDetailFocus.requestKey;
      setPendingItemDetailFocus(null);
    });

    return () => {
      window.cancelAnimationFrame(firstRaf);
      window.clearTimeout(retryTimeout);
    };
  }, [
    activeView,
    computed,
    floatingDetailRef,
    openFloatingDetail,
    open,
    pendingItemDetailFocus,
    shakeFloatingEditor,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
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
    resolveSelectedAgendaEditAnchor,
    openFloatingEventEdit,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingDeadlineCreate,
    toggleEventOverlay,
    deadlineOverlayVisible,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: (value) => {
      setDeadlineOverlayVisible(value);
      writeStoredBoolean(typeof window === "undefined" ? null : window.localStorage, DEADLINE_OVERLAY_STORAGE_KEY, value);
    },
    navigateMonthRef,
    onCopySelectedEvent: copySelectedCalendarEvent,
    onPasteCopiedEvent: pasteCopiedCalendarEvent,
    onDeleteSelectedEvents: requestSelectedCalendarEventDelete,
    onBeginEventSelectionSetFromSelected: addSelectedCalendarEventToSelectionSet,
    openCalendarSearch: calendarSearch.openSearch,
  });

  useEffect(() => {
    if (!open || view !== "events" || !eventsEnsureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    onEventsVisibleRangeChange?.({ start, end });
    const runEnsure = () => {
      let canceled = false;
      let eventsDone = false;
      let deadlinesDone = !deadlineOverlayVisible || !deadlinesEnsureRange;
      let deadlinesTimedOut = false;
      const startedAt = performance.now();
      setPlanningReadiness(planningInitialState({
        deadlineOverlayVisible,
        deadlinesDone,
        startedAt,
      }));
      setLateDeadlineOverlayData(null);

      const softTimer = window.setTimeout(() => {
        if (canceled || !deadlineOverlayVisible) return;
        setPlanningReadiness((current) => planningSlowState(current, {
          eventsDone,
          deadlinesDone,
        }));
      }, 2000);
      const hardTimer = window.setTimeout(() => {
        if (canceled || !deadlineOverlayVisible || deadlinesDone || !eventsDone) return;
        deadlinesTimedOut = true;
        setCommittedDeadlineOverlayData(null);
        setPlanningReadiness((current) => planningDeadlineTimedOutState(current));
      }, 3000);

      const eventsPromise = eventsEnsureRange(start, end)
        .then(() => {
          eventsDone = true;
          if (canceled) return;
          setPlanningReadiness((current) => planningEventsReadyState(current, {
            now: performance.now(),
          }));
        });
      const deadlinesPromise = deadlineOverlayVisible && deadlinesEnsureRange
        ? deadlinesEnsureRange(start, end)
          .then((data) => {
            deadlinesDone = true;
            if (canceled) return;
            if (deadlinesTimedOut) {
              setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
                deadlinesTimedOut: true,
              }));
              return;
            }
            if (eventsDone) {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setLateDeadlineOverlayData(null);
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
              }));
            } else {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
              }));
            }
          })
        : Promise.resolve(null);

      Promise.allSettled([eventsPromise, deadlinesPromise]).then((results) => {
        if (canceled) return;
        const failed = results.find((result) => result.status === "rejected");
        if (failed) {
          setPlanningReadiness((current) => planningSettledState(current, {
            failed: true,
          }));
          return;
        }
        if (!deadlineOverlayVisible) return;
        if (deadlinesDone && eventsDone) {
          setPlanningReadiness((current) => planningSettledState(current, {
            failed: false,
            deadlineOverlayVisible,
            deadlinesDone,
            eventsDone,
          }));
        }
      });

      deadlinesPromise.then((data) => {
        if (canceled || !deadlineOverlayVisible || !data) return;
        setPlanningReadiness((current) => {
          if (!current.deadlinesDelayed) return current;
          setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
          return planningLateDeadlinesReadyState(current);
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
  }, [open, view, viewYear, viewMonth, eventsEnsureRange, eventsRevision, eventEditor.isEditorOpen, onEventsVisibleRangeChange, deadlineOverlayVisible, deadlinesEnsureRange]);

  const domainEnsureRange = viewData?.ensureRange;
  const domainRevision = viewData?.revision;
  useEffect(() => {
    if (!open || view === "events" || !domainEnsureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    domainEnsureRange(start, end).catch((err) => {
      console.error(`[Calendar] ${view} range fetch failed:`, err);
    });
  }, [domainEnsureRange, domainRevision, open, view, viewYear, viewMonth]);

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

  const calendarSearchShell = useMemo(() => ({
    ...calendarSearch,
    selectedDateKey: activeSelectedDateKey,
    selectedItemId: activeSelectedItemId,
    activateDateHeader: activateCalendarSearchDateHeader,
    getResultActivationContext: getCalendarSearchResultActivationContext,
    isResultNavigable: isCalendarSearchResultGridNavigable,
  }), [
    activateCalendarSearchDateHeader,
    activeSelectedDateKey,
    activeSelectedItemId,
    calendarSearch,
    getCalendarSearchResultActivationContext,
    isCalendarSearchResultGridNavigable,
  ]);

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
        eventOverlay: view === "events"
          ? {
              enabled: eventOverlayVisible,
              onToggle: toggleEventOverlay,
            }
          : null,
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
      agendaEntryTargetDateKey: effectiveAgendaEntryTargetDateKey,
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
    search: calendarSearchShell,
  });

  return (
    <CalendarModalShell {...shellProps} />
  );
}
