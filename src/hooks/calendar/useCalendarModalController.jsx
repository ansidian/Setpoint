import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "../../components/calendar/views/billsView.jsx";
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
import {
  deadlineItemsFromData,
  getDeadlineSelectionId,
} from "../../components/calendar/views/deadlines/deadlinesModel.js";
import CalendarModalShell from "../../components/calendar/modal/CalendarModalShell.jsx";
import buildCalendarModalShellProps from "../../components/calendar/modal/buildCalendarModalShellProps.js";
import {
  getVisibleGridRange,
  parseYmd,
  ymdFromParts,
} from "../../components/calendar/calendarDateUtils.js";
import {
  dateToMonthIndex,
  deriveScrollDirection,
  monthIndexToDate,
  NAVIGABLE_MONTH_RADIUS,
} from "./calendarScrollModel.js";
import useCalendarFloatingDetail from "./useCalendarFloatingDetail.js";
import useDashboardFocusRetry from "./useDashboardFocusRetry.js";
import useDeadlineOverlayState from "./useDeadlineOverlayState.js";
import useFloatingEditorRouting from "./useFloatingEditorRouting.js";
import usePlanningReadinessState from "./usePlanningReadinessState.js";
import useAgendaSyncPolicy from "./useAgendaSyncPolicy.js";
import useCalendarModalHotkeys from "./useCalendarModalHotkeys.js";
import useCalendarModalOutsideDismiss from "./useCalendarModalOutsideDismiss.js";
import useCalendarModalSearch from "./useCalendarModalSearch.js";
import useCalendarModalSelection from "./useCalendarModalSelection.js";
import useCalendarModalViewModel from "./useCalendarModalViewModel.js";
import useCalendarModalWheelContainment from "./useCalendarModalWheelContainment.js";
import useCalendarScrollSync from "./useCalendarScrollSync.js";
import useViewportWidth from "./useViewportWidth.js";
import { activationTargetFromCalendarSearchResult } from "./calendarModalSearchModel.js";
import { isGoogleSpecialDateEvent } from "../../components/calendar/googleSpecialDateModel.js";
import {
  dashboardDetailFocusRequest,
  normalizeCalendarWorkspaceView,
} from "./calendarModalInteractionModel.js";

const VIEWS = {
  events: eventsView,
  bills: billsView,
};
const SCROLL_IDLE_THRESHOLD_MS = 400;
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

function rawDeadlineIdFromOccurrenceId(itemId) {
  const text = String(itemId || "");
  if (!text.startsWith("deadline:")) return null;
  const lastColon = text.lastIndexOf(":");
  if (lastColon <= "deadline:".length) return null;
  return text.slice("deadline:".length, lastColon) || null;
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
    const rawDeadlineId = result.payload?.id || result.activation?.deadlineId || result.rawDeadlineId || result.itemId;
    return {
      ...(result.payload || {}),
      id: rawDeadlineId,
      agendaItemId: result.itemId,
      title: result.title,
      agendaDateKey: result.itemDate,
      due_date: result.itemDate,
      class_name: result.subtitle || "",
      status: result.status || result.payload?.status || "open",
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

const EMPTY_CALENDAR_EVENTS = [];

function deadlineOverlayRecordData(record, visibleRange) {
  if (!record) return null;
  if (record.range && !rangeMatches(record.range, visibleRange)) return null;
  return record.data || record;
}

function hasDeadlineItemsInRange(data, range) {
  if (!data || !range) return false;
  for (const item of deadlineItemsFromData(data)) {
    const dueDate = item?.agendaDateKey || item?.due_date || item?.dueDate || item?.date;
    if (dueDate && dueDate >= range.start && dueDate <= range.end) return true;
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

  const rawDeadlineId = rawDeadlineIdFromOccurrenceId(itemId);
  if (rawDeadlineId && allMatches.some(({ item }) => isCompleteItem(item))) {
    const currentOccurrence = Object.values(allByDate)
      .flatMap((pool) => itemsFromDatePool(activeView, pool))
      .find((item) => String(item?.id) === rawDeadlineId && !isCompleteItem(item));
    if (currentOccurrence) return currentOccurrence;
  }

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

export default function useCalendarModalController({
  open,
  onClose,
  view: requestedView,
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
  const view = normalizeCalendarWorkspaceView(requestedView);
  const {
    currentMonth,
    currentYear,
    todayDate,
    setViewDate,
    fetchAnchor,
    setFetchAnchor,
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
  const viewportWidth = useViewportWidth();
  const {
    eventOverlayVisible,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    toggleEventOverlay,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
  } = useDeadlineOverlayState({
    open,
    view,
    forceEventOverlay,
    forceDeadlineOverlay,
    forceCompletedDeadlineOverlay,
    openRequestId,
  });
  const [labelMonth, setLabelMonth] = useState(() => ({ year: activeViewDate.year, month: activeViewDate.month }));
  const [manualMonthBrowseKey, setManualMonthBrowseKey] = useState(0);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [agendaScrollCommand, setAgendaScrollCommand] = useState(null);
  const [agendaEntryScrollReleased, setAgendaEntryScrollReleased] = useState(false);
  const [pendingItemDetailFocus, setPendingItemDetailFocus] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const agendaRailRef = useRef(null);
  const contextRailRef = useRef(null);
  const handledInitialDeadlineCreateRef = useRef(null);
  const handledDashboardDetailFocusRef = useRef(null);
  const dashboardDetailFocusRafRef = useRef(0);
  const navigateMonthRef = useRef(null);
  const eventEditorRef = useRef(null);
  const agendaSelectionAnchorRef = useRef(null);
  const searchActivationSeqRef = useRef(0);
  const scrollDirectionRef = useRef("idle");
  const prevMonthIndexRef = useRef(null);
  const scrollDrivenRef = useRef(false);
  // Mirror of the fetch anchor so settle handling can tell a real anchor
  // move from an echo that lands on the already-anchored month.
  const fetchAnchorRef = useRef(fetchAnchor);
  useEffect(() => {
    fetchAnchorRef.current = fetchAnchor;
  }, [fetchAnchor]);
  const fetchAbortRef = useRef(null);
  const searchResultGridNavigableRef = useRef(() => true);
  const {
    floatingDetail,
    setFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
    closeFloatingDetail,
    setFloatingDetailDragged,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setFloatingEditorDirty,
    setFloatingEditorSaveRequest,
  } = useCalendarFloatingDetail({ open, view, panelRef, railRef: contextRailRef });

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const fetchYear = fetchAnchor.year;
  const fetchMonth = fetchAnchor.month;
  const activeView = VIEWS[view] || eventsView;
  const activeLayout = getCalendarLayoutMetrics(viewportWidth);
  const usesFloatingEditor = !activeLayout.stacked;

  function isEditorDirty() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty)
      || (eventEditorRef.current?.isEditorOpen && eventEditorRef.current?.isDirty)
    );
  }
  function isEditorOpen() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create"))
      || eventEditorRef.current?.isEditorOpen
      || deadlineEditor?.mode
    );
  }
  const { suppressAgendaPassiveSync, shouldIgnorePassiveAgendaSync } = useAgendaSyncPolicy();

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

  const sync = useCalendarScrollSync({
    requestAgendaScroll,
    viewDate: { year: viewYear, month: viewMonth },
    firstDay: new Date(viewYear, viewMonth, 1).getDay(),
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    isDirtyCheck: isEditorDirty,
    isEditorOpenCheck: isEditorOpen,
    shakeEditor: shakeFloatingEditor,
  });
  const agendaEntryTargetDateKey = useMemo(() => {
    if (!open) return null;
    if (focusDate && parseYmd(focusDate)) return focusDate;
    return todayDateKey;
  }, [focusDate, open, todayDateKey]);
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
  const eventsCacheStamp = eventsData?.cacheStamp ?? 0;
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

  function focusEditorDate(ymd) {
    focusDateKey(ymd);
  }

  const {
    deadlineEditor,
    deadlineDraftPreview,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    cancelFloatingEditor,
    handleEventEditorDeleted,
    handleEventEditorSaved,
    handleFloatingDeadlineDeleted,
    handleFloatingDeadlineSaved,
    openFloatingDeadlineCreate,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingEventEdit,
  } = useFloatingEditorRouting({
    activeSelectedDateKey,
    activeView,
    eventEditorRef,
    findDateCell,
    floatingDetailRef,
    focusDate,
    focusItemId,
    forceDeadlineOverlay,
    open,
    openFloatingDetail,
    selectedDay,
    selectedItemId,
    setFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    suppressAgendaPassiveSync,
    todayDateKey,
    view,
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

  const {
    planningReadiness,
    setPlanningReadiness,
    committedDeadlineOverlayData,
    setCommittedDeadlineOverlayData,
    lateDeadlineOverlayData,
    setLateDeadlineOverlayData,
  } = usePlanningReadinessState({
    open,
    view,
    fetchYear,
    fetchMonth,
    currentYear,
    currentMonth,
    scrollDrivenRef,
    scrollDirectionRef,
    fetchAbortRef,
    eventsEnsureRange,
    eventsRevision,
    eventEditorIsEditorOpen: eventEditor.isEditorOpen,
    onEventsVisibleRangeChange,
    deadlineOverlayVisible,
    deadlinesEnsureRange,
  });

  // The three-month event window and the deadline overlay used to be built
  // inline inside the viewData memo, so every status churn (loading toggles,
  // readiness transitions, per-settle commits) handed grids, previews, and
  // the agenda rail fresh identities for unchanged data. They are memoized
  // separately so viewData rebuilds cannot invalidate downstream memos unless
  // the underlying data actually changed.
  const visibleCalendarEvents = useMemo(() => {
    if (view !== "events" || !eventOverlayVisible || !eventsGetEvents) return EMPTY_CALENDAR_EVENTS;
    const prevMonth = addMonthOffset(viewYear, viewMonth, -1);
    const nextMonth = addMonthOffset(viewYear, viewMonth, 1);
    return dedupeEvents([
      ...(eventsGetEvents(prevMonth.year, prevMonth.month) || []),
      ...(eventsGetEvents(viewYear, viewMonth) || []),
      ...(eventsGetEvents(nextMonth.year, nextMonth.month) || []),
    ]);
    // eventsCacheStamp invalidates the ref-backed eventsGetEvents reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, eventOverlayVisible, eventsGetEvents, viewYear, viewMonth, eventsCacheStamp]);

  const lateDeadlineRecord = useMemo(() => {
    if (view !== "events") return null;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    return deadlineOverlayRecordData(lateDeadlineOverlayData, visibleRange) ? lateDeadlineOverlayData : null;
  }, [view, viewYear, viewMonth, lateDeadlineOverlayData]);

  const applyLateDeadlines = useCallback(() => {
    if (!lateDeadlineRecord) return;
    setCommittedDeadlineOverlayData(lateDeadlineRecord);
    setLateDeadlineOverlayData(null);
    setPlanningReadiness((current) => ({
      ...current,
      state: "ready",
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
    }));
  }, [lateDeadlineRecord, setCommittedDeadlineOverlayData, setLateDeadlineOverlayData, setPlanningReadiness]);

  const deadlinesDelayed = !!planningReadiness.deadlinesDelayed;
  const deadlineOverlayCandidate = useMemo(() => {
    if (view !== "events") return null;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    const committedOverlayData = deadlineOverlayRecordData(committedDeadlineOverlayData, visibleRange);
    const seededOverlayData = !deadlinesDelayed
      && (!deadlinesRangeData?.dataRange || rangeMatches(deadlinesRangeData.dataRange, visibleRange))
      ? deadlinesRangeData?.data
      : null;
    const currentOverlayData = !deadlinesDelayed ? deadlinesData : null;
    const overlayData = committedOverlayData || seededOverlayData || currentOverlayData;
    return {
      enabled: deadlineOverlayVisible,
      showCompleted: completedDeadlineOverlayVisible,
      data: deadlineOverlayVisible ? overlayData : null,
      onApplyLateDeadlines: lateDeadlineRecord ? applyLateDeadlines : null,
    };
  }, [
    view,
    viewYear,
    viewMonth,
    committedDeadlineOverlayData,
    deadlinesDelayed,
    deadlinesRangeData?.dataRange,
    deadlinesRangeData?.data,
    deadlinesData,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    lateDeadlineRecord,
    applyLateDeadlines,
  ]);

  // Month crossings recompute the candidate (the committed record is gated on
  // the visible range), usually to field-identical output. Reuse the previous
  // object so downstream memos keyed on overlay identity stay warm.
  const deadlineOverlayRef = useRef(null);
  const prevDeadlineOverlay = deadlineOverlayRef.current;
  const deadlineOverlay = prevDeadlineOverlay
    && deadlineOverlayCandidate
    && prevDeadlineOverlay.enabled === deadlineOverlayCandidate.enabled
    && prevDeadlineOverlay.showCompleted === deadlineOverlayCandidate.showCompleted
    && prevDeadlineOverlay.data === deadlineOverlayCandidate.data
    && prevDeadlineOverlay.onApplyLateDeadlines === deadlineOverlayCandidate.onApplyLateDeadlines
    ? prevDeadlineOverlay
    : deadlineOverlayCandidate;
  deadlineOverlayRef.current = deadlineOverlay;

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
      return {
        events: visibleCalendarEvents,
        deadlineOverlay,
        planningReadiness,
        isLoading: eventsRangeLoading,
        agendaEntryReady,
        pendingUpdate: eventsStaleRefreshPending,
        hasMonth: eventsHasMonth?.(viewYear, viewMonth) || false,
        revision: eventsRevision,
      };
    }
    const rangeData = billsRangeData?.data;
    const activeBillsData = rangeData || billsData;
    const visibleBillsCount = (activeBillsData?.schedules || activeBillsData?.allSchedules || []).length;
    const broadSchedules = billsData?.schedules
      || billsData?.allSchedules
      || activeBillsData?.schedules
      || [];
    return {
      ...activeBillsData,
      allSchedules: broadSchedules,
      isLoading: !!billsRangeData?.loading || billsData?.isLoading,
      pendingUpdate: !!visibleBillsCount && (!!billsRangeData?.loading || !!billsData?.pendingUpdate || !!rangeData?.pendingUpdate),
      rangeError: billsRangeData?.error || null,
      ensureRange: billsRangeData?.ensureRange,
      revision: billsRangeData?.revision,
    };
  }, [
    view,
    eventsEnsureRange,
    eventsHasMonth,
    eventsIsMonthLoading,
    eventsLoading,
    eventsStaleRefreshPending,
    eventsRevision,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    committedDeadlineOverlayData,
    deadlinesRangeData?.ensureRange,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    planningReadiness,
    deadlinesData,
    visibleCalendarEvents,
    deadlineOverlay,
    billsData,
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
    // Re-committing an identical record per settle would churn the overlay
    // identity (and everything memoized on it) without changing content.
    setCommittedDeadlineOverlayData((current) => (
      current
        && current.data === deadlinesRangeData.data
        && rangeMatches(current.range, deadlinesRangeData.dataRange)
        ? current
        : makeDeadlineOverlayRecord(deadlinesRangeData.data, deadlinesRangeData.dataRange)
    ));
  }, [
    view,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    deadlinesRangeData?.revision,
    setCommittedDeadlineOverlayData,
  ]);

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
    closeEventEditor();
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(target.dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
    }
    setSelectedDay(parsed.day);
    setSelectedDateKey(target.dateKey);
    setSelectedItemId(target.itemId);
    searchActivationSeqRef.current += 1;
    const requestKey = `search:${searchActivationSeqRef.current}:${targetView}:${target.dateKey}:${target.itemId}`;
    setPendingItemDetailFocus({
      openRequestId: searchActivationSeqRef.current,
      view: targetView,
      detailKind: target.detailKind || null,
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
    searchTargetVisibleInCurrentGrid,
    setFetchAnchor,
    setLabelMonth,
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
      if (current.detailKind === "deadline") {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      }
    } else {
      closeEventEditor();
    }
    setFloatingDetail(null);
    if (!searchTargetVisibleInCurrentGrid(dateKey)) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
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
    setFetchAnchor,
    setLabelMonth,
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

  useLayoutEffect(() => {
    if (
      !open
      || view !== "events"
      || completedDeadlineOverlayVisible
      || !floatingDetail?.open
      || floatingDetail.detailKind !== "deadline"
    ) return;
    const snapshotItem = (floatingDetail.itemsSnapshot || []).find((item) => (
      itemMatchesViewId(activeView, item, floatingDetail.itemId)
    ));
    if (!isCompleteItem(snapshotItem)) return;
    setFloatingDetail(null);
    setSelectedItemId(null);
  }, [
    activeView,
    completedDeadlineOverlayVisible,
    floatingDetail,
    open,
    setFloatingDetail,
    setSelectedItemId,
    view,
  ]);

  // Mirror the inputs of selected-event resolution so the resolver (and the
  // selection handlers built on it) keep one identity across month crossings;
  // a fresh resolver per crossing would re-render every mounted month grid
  // through the quick-actions chain.
  const selectionResolutionRef = useRef({ events: EMPTY_CALENDAR_EVENTS, itemId: null });
  useEffect(() => {
    selectionResolutionRef.current = { events: visibleCalendarEvents, itemId: activeSelectedItemId };
  });
  const resolveSelectedCalendarEvent = useCallback(() => {
    const { events, itemId: selectionItemId } = selectionResolutionRef.current;
    if (view !== "events" || selectionItemId == null) return null;
    const selected = events.find((event) => {
      const itemId = activeView.getItemId ? activeView.getItemId(event) : event.id;
      return String(itemId) === String(selectionItemId);
    });
    if (!selected?.startMs || !selected?.calendarId || !selected?.accountId) return null;
    return selected;
  }, [activeView, view]);

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

  // Returns true only when a selection set was actually begun; ineligible
  // events (special dates, read-only sources) return false so the bare
  // cmd/ctrl hotkey falls through to dismissing the floating detail.
  const addSelectedCalendarEventToSelectionSet = useCallback(() => {
    const selectedEvent = resolveSelectedCalendarEvent();
    if (!calendarEventSelectionIdentity(selectedEvent)) {
      return false;
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
    // Special dates (birthdays) can never join the selection set, but a
    // modifier-click on them still follows the same dismiss path as any
    // other chip so the floating detail closes consistently.
    const dismissOnly = !eventIdentity && isGoogleSpecialDateEvent(event);
    if (!eventIdentity && !dismissOnly) return false;
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
    if (dismissOnly) return true;
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

  // The toggle handler's identity follows editor/floating-detail callbacks;
  // routing it through a ref keeps eventQuickActions (a prop of every mounted
  // month grid) stable across controller re-renders that don't change the
  // selection itself.
  const toggleCalendarEventSelectionSetRef = useRef(null);
  useEffect(() => {
    toggleCalendarEventSelectionSetRef.current = toggleCalendarEventSelectionSet;
  });
  const stableToggleEventSelection = useCallback(
    (...args) => toggleCalendarEventSelectionSetRef.current?.(...args),
    [],
  );

  const eventQuickActions = useMemo(() => ({
    ...baseEventQuickActions,
    eventSelectionActive: calendarEventSelectionCount > 0,
    eventSelectionCount: calendarEventSelectionCount,
    clearEventSelection: clearCalendarEventSelectionSet,
    isEventSelectionSelected: (event) => isCalendarEventSelected(calendarEventSelectionSet, event),
    toggleEventSelection: stableToggleEventSelection,
  }), [
    baseEventQuickActions,
    calendarEventSelectionCount,
    calendarEventSelectionSet,
    clearCalendarEventSelectionSet,
    stableToggleEventSelection,
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
    enabled: open && view === "events" && deadlineOverlayVisible,
    actions: deadlineActions,
    onEditTask: (task, options = {}) => {
      if (activeLayout.stacked) {
        const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
        const parsed = parseYmd(dateKey);
        if (parsed) {
          setSelectedDay(parsed.day);
          setSelectedDateKey(dateKey);
        }
        setSelectedItemId(getDeadlineSelectionId(task, dateKey));
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
    if (
      (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty)
      || (eventEditorRef.current?.isEditorOpen && eventEditorRef.current?.isDirty)
    ) {
      shakeFloatingEditor();
      return;
    }
    setFloatingDetail(null);
    setSuppressFocusRing(false);
    onClose();
  }, [floatingDetailRef, onClose, setFloatingDetail, setSuppressFocusRing, shakeFloatingEditor]);

  function navigateMonth(dir, _options = {}) {
    const currentFloating = floatingDetailRef.current;
    const anyEditorOpen = (currentFloating?.open && (currentFloating.mode === "edit" || currentFloating.mode === "create"))
      || eventEditorRef.current?.isEditorOpen
      || deadlineEditor?.mode;

    if (!anyEditorOpen) {
      setDeadlineDraftPreview(null);
    }
    if (!anyEditorOpen && !currentFloating?.open) {
      closeEventEditor();
      setSelectedDay(null);
      setSelectedDateKey(null);
      setSelectedItemId(null);
      setDeadlineEditor(null);
    }
    setManualMonthBrowseKey((key) => key + 1);

    const next = clampToNavigableMonth(viewYear * 12 + viewMonth + dir);
    setViewDate(next);
    setFetchAnchor(next);
    setLabelMonth(next);
    sync.syncAgendaToMonth(next.year, next.month);
  }
  function clampToNavigableMonth(totalMonths) {
    const index = totalMonths - (currentYear * 12 + currentMonth);
    const clamped = Math.max(-NAVIGABLE_MONTH_RADIUS, Math.min(NAVIGABLE_MONTH_RADIUS, index));
    return monthIndexToDate(clamped, currentYear, currentMonth);
  }
  function jumpToMonth(year, month) {
    const currentFloating = floatingDetailRef.current;
    const anyEditorOpen = (currentFloating?.open && (currentFloating.mode === "edit" || currentFloating.mode === "create"))
      || eventEditorRef.current?.isEditorOpen
      || deadlineEditor?.mode;

    setDeadlineDraftPreview(null);
    if (!anyEditorOpen && !currentFloating?.open) {
      closeEventEditor();
      setSelectedDay(null);
      setSelectedDateKey(null);
      setSelectedItemId(null);
      setDeadlineEditor(null);
    }
    const target = clampToNavigableMonth(year * 12 + month);
    setViewDate(target);
    setFetchAnchor(target);
    setLabelMonth(target);
    sync.syncAgendaToMonth(target.year, target.month);
  }

  useEffect(() => {
    navigateMonthRef.current = navigateMonth;
  });

  const scrollIdleTimerRef = useRef(null);
  const handleScrollDisplayMonth = useCallback(({ year, month }) => {
    const currentIndex = dateToMonthIndex(year, month, currentYear, currentMonth);
    scrollDirectionRef.current = deriveScrollDirection(prevMonthIndexRef.current, currentIndex);
    prevMonthIndexRef.current = currentIndex;
    if (scrollIdleTimerRef.current != null) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollDirectionRef.current = "idle";
      scrollIdleTimerRef.current = null;
    }, SCROLL_IDLE_THRESHOLD_MS);
    if (sync.isAgendaDriven()) return;
    const fd = floatingDetailRef.current;
    if (fd?.open && (fd.mode === "edit" || fd.mode === "create")) return;
    setViewDate({ year, month });
    sync.onGridScrollCrossing({ year, month });
  }, [currentYear, currentMonth, setViewDate, sync, floatingDetailRef]);
  const handleScrollLabelMonth = useCallback(({ year, month }) => {
    if (sync.isAgendaDriven()) return;
    setLabelMonth((current) => (
      current.year === year && current.month === month ? current : { year, month }
    ));
  }, [sync]);
  const handleScrollFetchSettle = useCallback(({ year, month, scrollDriven = true }) => {
    const anchor = fetchAnchorRef.current;
    if (anchor.year !== year || anchor.month !== month) {
      // Only an anchor change re-runs the planning pass that consumes this
      // flag; setting it on an already-anchored echo settle would leave it
      // stale for the next jump or overlay toggle. Respect the settle's own
      // scrollDriven verdict — a programmatic echo that does move the anchor
      // must still reset planning state normally.
      scrollDrivenRef.current = scrollDriven;
    }
    setFetchAnchor({ year, month });
    // The agenda-driven gate only skips rail re-targeting: while the rail
    // drives navigation, grid follow-scroll settles must still move the
    // fetch anchor or the settled month's planning data never resolves.
    if (sync.isAgendaDriven()) return;
    // Programmatic-navigation echoes must not re-target the rail: the
    // navigation already issued its own agenda command (often more specific
    // than first-of-month, e.g. the today command).
    if (!scrollDriven) return;
    const fd = floatingDetailRef.current;
    if (fd?.open && (fd.mode === "edit" || fd.mode === "create")) return;
    sync.onGridScrollSettle({ year, month });
  }, [setFetchAnchor, sync, floatingDetailRef]);

  function focusDeadlineTask(task) {
    focusDateKey(task?.due_date);
    const itemId = getDeadlineSelectionId(task);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  // Active selection (explicit user action: click, mini-calendar, etc.) always wins.
  // Passive sync (agenda hover) is gated by the agenda sync policy (D-CAL-11): it is
  // skipped while the suppression window is open or a grid-anchored detail owns the
  // selection. Both entry points (onAgendaSelectDate / onAgendaHoverDate) below share
  // this implementation.
  function applyAgendaDateSelection(dateKey, { passive = false } = {}) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (passive && shouldIgnorePassiveAgendaSync(current)) return;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (passive) return;
      if (current.dirty) {
        shakeFloatingEditor();
        return;
      }
      if (current.view === "events") eventEditor.closeEditor?.();
      if (current.detailKind === "deadline") {
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
  }

  // Explicit agenda date action (click / keyboard / mini-calendar).
  const onAgendaSelectDate = (dateKey) => applyAgendaDateSelection(dateKey);
  // Passive agenda hover follow.
  const onAgendaHoverDate = (dateKey) => applyAgendaDateSelection(dateKey, { passive: true });

  function selectAgendaEvent({ event, item, dateKey, anchorElement, sourceCellElement, anchorKind, detailKind, preserveEventSelection = false }) {
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
      view,
      detailKind: detailKind || null,
      itemId,
      dateKey,
      day: parsed.day,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorKind || "agenda-row",
      itemsSnapshot: [selectedItem],
    });
  }

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

  function activateMiniCalendarDate(dateKey) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return false;
    if (isEditorDirty()) { shakeFloatingEditor(); return false; }
    if (parsed.year !== viewYear || parsed.month !== viewMonth) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
    }
    onAgendaSelectDate(dateKey);
    scrollAgendaToDate(dateKey);
    return true;
  }

  function createMiniCalendarEvent(dateKey) {
    if (!activateMiniCalendarDate(dateKey)) return false;
    openFloatingEventCreate(dateKey);
    return true;
  }

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
      view === "events" && forceDeadlineOverlay
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
    labelYear: labelMonth.year,
    labelMonthValue: labelMonth.month,
    activeSelectedDay,
    activeSelectedDateKey,
    activeSelectedItemId,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    weatherData,
    floatingDetail,
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
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
      if (!target.detailKind && result?.type === "event" && !eventOverlayVisible) return false;
      if (target.detailKind === "deadline") return true;
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

  const shellViewData = viewData;

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
      forceDeadlineOverlay,
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
        && current.detailKind === request.detailKind
        && current.dateKey === request.dateKey
        && current.itemId === request.itemId
      ) {
        return current;
      }
      return request;
    });
  }, [activeSelectedDateKey, focusDate, focusItemId, focusOpenDetail, forceDeadlineOverlay, open, openRequestId, usesFloatingEditor, view]);

  // One attach attempt for a pending dashboard-detail focus request. Returns a
  // status the retry scheduler understands: "done" (attached), "abort" (no
  // longer applicable), or "retry" (target not in the DOM yet). The scheduler
  // (useDashboardFocusRetry) owns the 250 ms cadence and give-up counting, so
  // this reads the latest controller state on every poll without re-rendering.
  const attemptDashboardDetailFocus = (request) => {
    const currentDetail = floatingDetailRef.current;
    if (
      currentDetail?.open
      && (currentDetail.mode === "edit" || currentDetail.mode === "create")
      && currentDetail.dirty
    ) {
      shakeFloatingEditor();
      setPendingItemDetailFocus(null);
      return "abort";
    }

    const resolvedItem = resolvePendingFocusItem({
      activeView,
      computed,
      dateKey: request.dateKey,
      itemId: request.itemId,
    });
    const item = resolvedItem || (
      request.anchorKind === "search-result-row"
        ? itemFromCalendarSearchResult(request.searchResult)
        : null
    );
    if (!item) return "retry";

    const resolvedDateKey = itemDueDate(item) || request.dateKey;
    const resolvedItemId = String(
      activeView.getItemId ? activeView.getItemId(item) : item.id,
    );

    if (request.anchorKind === "grid-chip") {
      const anchorElement = findGridChipAnchor(panelRef.current, resolvedItemId, resolvedDateKey);
      if (!anchorElement) return "retry";
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return "abort";
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: request.view,
        detailKind: request.detailKind || null,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: anchorElement.closest?.("[role='gridcell']") || null,
        anchorKind: "chip",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
      return "done";
    }

    if (request.anchorKind === "search-result-row") {
      const anchorElement = request.anchorElement?.isConnected
        ? request.anchorElement
        : null;
      if (!anchorElement) return "retry";
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return "abort";
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: request.view,
        detailKind: request.detailKind || null,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: request.sourceCellElement?.isConnected
          ? request.sourceCellElement
          : anchorElement,
        anchorKind: "search-result-row",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
      return "done";
    }

    // Defer agenda activation by one frame so the rail can lay out before we
    // activate it (prevents a scroll jump). The synchronous call reports
    // "retry" so the scheduler keeps polling until the deferred activation
    // succeeds (which clears the pending request) or the loop gives up.
    window.cancelAnimationFrame(dashboardDetailFocusRafRef.current);
    dashboardDetailFocusRafRef.current = window.requestAnimationFrame(() => {
      suppressAgendaPassiveSync();
      const activated = agendaRailRef.current?.activateItem?.(
        resolvedItemId,
        resolvedDateKey,
      );
      if (!activated) return;
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
    });
    return "retry";
  };

  const {
    retryFocus: retryDashboardDetailFocus,
    cancelFocus: cancelDashboardDetailFocus,
  } = useDashboardFocusRetry({
    attempt: attemptDashboardDetailFocus,
    onGiveUp: () => setPendingItemDetailFocus(null),
  });

  useEffect(() => {
    if (!pendingItemDetailFocus || !open || !usesFloatingEditor) return undefined;
    if (pendingItemDetailFocus.view !== view) return undefined;
    retryDashboardDetailFocus(pendingItemDetailFocus);
    return () => {
      cancelDashboardDetailFocus();
      window.cancelAnimationFrame(dashboardDetailFocusRafRef.current);
    };
  }, [
    pendingItemDetailFocus,
    open,
    usesFloatingEditor,
    view,
    retryDashboardDetailFocus,
    cancelDashboardDetailFocus,
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
    setFetchAnchor,
    setLabelMonth,
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
    setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
    navigateMonthRef,
    onCopySelectedEvent: copySelectedCalendarEvent,
    onPasteCopiedEvent: pasteCopiedCalendarEvent,
    onDeleteSelectedEvents: requestSelectedCalendarEventDelete,
    onBeginEventSelectionSetFromSelected: addSelectedCalendarEventToSelectionSet,
    openCalendarSearch: calendarSearch.openSearch,
    cancelCalendarSearch: calendarSearch.cancelSearch,
  });

  const domainEnsureRange = viewData?.ensureRange;
  const domainRevision = viewData?.revision;
  useEffect(() => {
    if (!open || view === "events" || !domainEnsureRange) return;
    const { start, end } = getVisibleGridRange(fetchYear, fetchMonth);
    domainEnsureRange(start, end).catch((err) => {
      if (err?.name === "AbortError") return;
      console.error(`[Calendar] ${view} range fetch failed:`, err);
    });
  }, [domainEnsureRange, domainRevision, open, view, fetchYear, fetchMonth]);

  useEffect(() => {
    const current = floatingDetailRef.current;
    // Deadline-kind panels host the Todoist editor and follow the deadline
    // editor lifecycle, not the event editor's — switching workspaces closes
    // the event editor while the deadline panel must stay up.
    if (!current?.open || current.view !== "events" || current.detailKind === "deadline" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (eventEditor.isEditorOpen) return;
    const id = window.requestAnimationFrame(() => {
      setFloatingDetail((latest) => {
        if (!latest?.open || latest.view !== "events" || latest.detailKind === "deadline" || (latest.mode !== "edit" && latest.mode !== "create")) return latest;
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
    viewState: { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, suppressFocusRing },
    data: { activeView, viewData: shellViewData, weatherData, isMonthCached: eventsHasMonth, getMonthEvents: eventsGetEvents, getMonthDeadlines: deadlinesRangeData?.getMonthData || null, eventsRange: eventsData || null, deadlinesRange: deadlinesRangeData || null, dataRevision: eventsCacheStamp },
    viewModel,
    selection: { activeSelectedDay, activeSelectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId, setViewDate },
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
      onAgendaPassiveDateChange: (dateKey) => {
        sync.onAgendaScroll(dateKey);
        onAgendaHoverDate(dateKey);
      },
      onAgendaDateAction: onAgendaSelectDate,
      onMiniCalendarDateAction: activateMiniCalendarDate,
      onMiniCalendarDateCreate: createMiniCalendarEvent,
      onAgendaEventAction: selectAgendaEvent,
      scrollAgendaToDate,
      scrollAgendaToEvent,
    },
    floating: {
      floatingDetail, openFloatingDetail, closeFloatingDetail, setFloatingDetailDragged,
      openFloatingEventCreate, openFloatingEventEdit, openFloatingDeadlineCreate, openFloatingDeadlineEdit,
      cancelFloatingEditor, setFloatingEditorDirty, setFloatingEditorSaveRequest, shakeFloatingEditor,
      handleFloatingDeadlineSaved, handleFloatingDeadlineDeleted,
    },
    handlers: { navigateMonth, jumpToMonth, handleViewChange, suppressOutsideClick, closeCalendarModal, closeEventEditor, focusDeadlineTask, onDisplayMonthChange: handleScrollDisplayMonth, onLabelMonthChange: handleScrollLabelMonth, onFetchSettle: handleScrollFetchSettle, navigateToDate: sync.navigateToDate, navigateToMonth: sync.navigateToMonth, navigateToToday: sync.navigateToToday },
    search: calendarSearchShell,
  });

  return (
    <CalendarModalShell {...shellProps} />
  );
}
