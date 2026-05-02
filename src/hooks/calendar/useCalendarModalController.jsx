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

export default function useCalendarModalController({
  open,
  onClose,
  view,
  onViewChange,
  eventsData,
  onEventsVisibleRangeChange,
  billsData,
  deadlinesData,
  weatherData,
  focusDate,
  focusItemId,
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
  const [deadlineEditor, setDeadlineEditor] = useState(() => (
    open && view === "deadlines" && focusItemId === "new"
      ? { mode: "create", seedDate: focusDate || null }
      : null
  ));
  const viewportWidth = useViewportWidth();
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState(null);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [agendaScrollCommand, setAgendaScrollCommand] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const agendaRailRef = useRef(null);
  const contextRailRef = useRef(null);
  const agendaPassiveSyncSuppressedUntilRef = useRef(0);
  const handledInitialDeadlineCreateRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const eventEditorRef = useRef(null);
  const [monthMotionDirection, setMonthMotionDirection] = useState(0);
  const {
    floatingDetail,
    setFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
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
      return {
        events: dedupeEvents([
          ...(eventsData?.getEvents?.(prevMonth.year, prevMonth.month) || []),
          ...(eventsData?.getEvents?.(viewYear, viewMonth) || []),
          ...(eventsData?.getEvents?.(nextMonth.year, nextMonth.month) || []),
        ]),
        isLoading: eventsData?.isMonthLoading?.(prevMonth.year, prevMonth.month)
          || eventsData?.isMonthLoading?.(viewYear, viewMonth)
          || eventsData?.isMonthLoading?.(nextMonth.year, nextMonth.month)
          || false,
        pendingUpdate: !!eventsData?.staleRefreshPending,
        hasMonth: eventsData?.hasMonth?.(viewYear, viewMonth) || false,
      };
    }
    if (view === "deadlines") return deadlinesData;
    return billsData;
  }, [view, eventsData, viewYear, viewMonth, deadlinesData, billsData]);

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
    enabled: open && view === "deadlines",
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

  function navigateMonth(dir) {
    setDeadlineDraftPreview(null);
    setMonthMotionDirection(dir > 0 ? 1 : -1);
    if (floatingDetail?.open) {
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
    setSelectedItemId(task?.id != null ? String(task.id) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  function selectAgendaDate(dateKey, { passive = false } = {}) {
    if (passive && performance.now() < agendaPassiveSyncSuppressedUntilRef.current) return;
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
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

  function selectAgendaEvent({ event, item, dateKey, anchorElement, sourceCellElement, anchorKind }) {
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
      view,
      itemId,
      dateKey,
      day: parsed.day,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorKind || "agenda-row",
      itemsSnapshot: [selectedItem],
    });
  }

  function requestAgendaScroll(command) {
    if (!command) return;
    suppressAgendaPassiveSync();
    setAgendaScrollCommand({
      ...command,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }

  function scrollAgendaToDate(dateKey) {
    requestAgendaScroll({ type: "date", dateKey });
  }

  function scrollAgendaToEvent(itemId, dateKey) {
    requestAgendaScroll({ type: "event", itemId, dateKey });
  }

  useEffect(() => {
    if (!open || view !== "deadlines" || focusItemId !== "new" || !usesFloatingEditor) return;
    const requestKey = `${openRequestId}:${focusDate || ""}`;
    if (handledInitialDeadlineCreateRef.current === requestKey) return;
    handledInitialDeadlineCreateRef.current = requestKey;
    window.requestAnimationFrame(() => {
      if (!floatingDetailRef.current?.open) {
        openFloatingDeadlineCreate(focusDate || activeSelectedDateKey || null);
      }
    });
    // Initial create focus is keyed by the explicit open request, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, focusItemId, openRequestId, focusDate, usesFloatingEditor]);

  const commitSyncSnapshotEffects = useEffectEvent((snapshot) => {
    if (snapshot?.didViewChange) {
      closeEventEditor();
      setDeadlineDraftPreview(null);
      setFloatingDetail(null);
    }
    if (snapshot?.resetDeadlineEditor) {
      setFloatingDetail(null);
    }
    if (snapshot?.openCreate && view === "events" && eventEditor.editable) {
      if (usesFloatingEditor) {
        openFloatingEventCreate(focusDate || snapshot.nextSelectedDateKey || null);
      } else {
        openEventCreate();
      }
    } else if (snapshot?.openCreate && view === "deadlines") {
      if (usesFloatingEditor) {
        openFloatingDeadlineCreate(focusDate || snapshot.nextSelectedDateKey || null);
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
    floatingDetail,
    setMonthMotionDirection,
    setViewDate,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
  });
  const { canGoPrev, computed, itemsByDay } = viewModel;

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
    navigateMonthRef,
  });

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    onEventsVisibleRangeChange?.({ start, end });
    if (eventEditor.isEditorOpen) {
      const id = window.setTimeout(() => eventsData.ensureRange(start, end), 260);
      return () => window.clearTimeout(id);
    }
    eventsData.ensureRange(start, end);
  }, [open, view, viewYear, viewMonth, eventsData, eventEditor.isEditorOpen, onEventsVisibleRangeChange]);

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
    viewState: { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, monthMotionDirection, suppressFocusRing },
    data: { activeView, viewData, weatherData },
    viewModel,
    selection: { activeSelectedDay, activeSelectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId },
    editors: { eventEditor, deadlineEditor, setDeadlineEditor, setDeadlineDraftPreview },
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
      floatingDetail, openFloatingDetail, closeFloatingDetail, parkFloatingDetail, setFloatingDetailDragged,
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
