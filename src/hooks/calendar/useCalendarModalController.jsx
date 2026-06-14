import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  removeCalendarEventSelection,
  resolveCalendarEventActionScope,
  toggleCalendarEventSelection,
} from "../../components/calendar/events/calendarEventSelectionModel.js";
import useCalendarQuickActions from "../../components/calendar/events/useCalendarQuickActions.js";
import useDeadlineQuickActions from "../../components/calendar/views/deadlines/useDeadlineQuickActions.js";
import { getDeadlineSelectionId } from "../../components/calendar/views/deadlines/deadlinesModel.js";
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
import useDashboardDetailFocus from "./useDashboardDetailFocus.js";
import useDeadlineOverlayState from "./useDeadlineOverlayState.js";
import useFloatingEditorRouting from "./useFloatingEditorRouting.js";
import useCalendarDeadlineOverlay from "./useCalendarDeadlineOverlay.js";
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
import { normalizeCalendarWorkspaceView } from "./calendarModalInteractionModel.js";
import {
  addMonthOffset,
  dedupeEvents,
  deadlineOverlayRecordData,
  EMPTY_CALENDAR_EVENTS,
  findGridChipAnchor,
  findItemLocation,
  hasDeadlineItemsInRange,
  isCompleteItem,
  itemMatchesViewId,
  rangeMatches,
  SCROLL_IDLE_THRESHOLD_MS,
  VIEWS,
} from "./calendarControllerHelpers.js";

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
  const removeFromCalendarEventSelectionSet = useCallback((events) => {
    const identities = (Array.isArray(events) ? events : [events])
      .map((event) => calendarEventSelectionIdentity(event))
      .filter(Boolean);
    if (!identities.length) return;
    setCalendarEventSelectionSet((current) => {
      if (calendarEventSelectionSize(current) === 0) return current;
      const next = identities.reduce(
        (selection, identity) => removeCalendarEventSelection(selection, identity),
        current,
      );
      return calendarEventSelectionSize(next) === calendarEventSelectionSize(current)
        ? current
        : next;
    });
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

  // Planning-readiness state machine + deadline-overlay derivation/stabilization
  // and the per-settle committed-overlay record (extracted to keep the
  // controller under the maintainability guardrail; behavior-identical).
  const {
    planningReadiness,
    committedDeadlineOverlayData,
    lateDeadlineOverlayData,
    deadlineOverlay,
  } = useCalendarDeadlineOverlay({
    open,
    view,
    fetchYear,
    fetchMonth,
    viewYear,
    viewMonth,
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
    completedDeadlineOverlayVisible,
    deadlinesEnsureRange,
    deadlinesRangeData,
    deadlinesData,
  });

  // The three-month event window used to be built inline inside the viewData
  // memo, so every status churn (loading toggles, readiness transitions,
  // per-settle commits) handed grids, previews, and the agenda rail fresh
  // identities for unchanged data. It is memoized separately so viewData
  // rebuilds cannot invalidate downstream memos unless the underlying events
  // actually changed.
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
    onBatchDeleted: removeFromCalendarEventSelectionSet,
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

  // Stable identity for the agenda passive-date-change handler so the prop
  // groups handed to the (memoizable) agenda rail do not churn every controller
  // render. sync.onAgendaScroll / onAgendaHoverDate are recreated each render, so
  // a latest-ref keeps the callback identity fixed while always invoking the
  // current closures. Behavior-preserving — same two calls, same order.
  const agendaPassiveDateChangeImplRef = useRef(null);
  agendaPassiveDateChangeImplRef.current = (dateKey) => {
    sync.onAgendaScroll(dateKey);
    onAgendaHoverDate(dateKey);
  };
  const handleAgendaPassiveDateChange = useCallback((dateKey) => {
    agendaPassiveDateChangeImplRef.current?.(dateKey);
  }, []);

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
    visibleCalendarEvents,
    deadlineOverlay,
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

  useDashboardDetailFocus({
    open,
    view,
    focusOpenDetail,
    focusItemId,
    focusDate,
    openRequestId,
    forceDeadlineOverlay,
    usesFloatingEditor,
    activeView,
    computed,
    activeSelectedDateKey,
    floatingDetailRef,
    panelRef,
    agendaRailRef,
    shakeFloatingEditor,
    suppressAgendaPassiveSync,
    openFloatingDetail,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    pendingItemDetailFocus,
    setPendingItemDetailFocus,
  });

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
      onAgendaPassiveDateChange: handleAgendaPassiveDateChange,
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
