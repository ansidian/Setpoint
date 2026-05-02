import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "../../components/calendar/views/billsView.jsx";
import deadlinesView from "../../components/calendar/views/deadlinesView.jsx";
import eventsView from "../../components/calendar/views/eventsView.jsx";
import { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.js";
import useCalendarEventEditor from "../../components/calendar/events/useCalendarEventEditor.js";
import useCalendarQuickActions from "../../components/calendar/events/useCalendarQuickActions.js";
import useDeadlineQuickActions from "../../components/calendar/views/deadlines/useDeadlineQuickActions.js";
import useCalendarGhostPreview from "../../components/calendar/useCalendarGhostPreview.js";
import CalendarModalShell from "../../components/calendar/modal/CalendarModalShell.jsx";
import { resolveFloatingDetailPlacement } from "../../components/calendar/modal/calendarFloatingDetailPlacement.js";
import {
  getMonthData,
  getVisibleGridRange,
  parseYmd,
  ymdFromParts,
} from "../../components/calendar/calendarDateUtils.js";
import useCalendarModalSelection from "./useCalendarModalSelection.js";
import { ymdFromView } from "./calendarModalSelectionModel.js";

const VIEWS = {
  events: eventsView,
  bills: billsView,
  deadlines: deadlinesView,
};

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function isSuspendedHotkeyTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-suspend-calendar-hotkeys='true']");
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

function buildFallbackDayState(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return {
    items,
    activeItems: items,
    completedItems: [],
    activeCount: items.length,
    completedCount: 0,
    totalCount: items.length,
  };
}

function isFloatingDetailTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment'], [data-testid='calendar-agenda-event-row'], [data-testid='calendar-agenda-event-chip'], [data-testid='calendar-agenda-bill-row'], [data-testid='calendar-agenda-deadline-row']");
}

function isFloatingDetailPanelTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-calendar-floating-detail='true']");
}

function isFloatingDetailFlipSuppressedTarget(target, detail) {
  if (!(target instanceof HTMLElement)) return false;
  const gridOriginTrigger = target.closest(
    "[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment']",
  );
  if (gridOriginTrigger && detail?.anchorElement === gridOriginTrigger) return false;

  return !!target.closest([
      "[data-calendar-floating-detail='true']",
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='button']",
      "[role='link']",
      "[role='menu']",
      "[role='menuitem']",
      "[role='listbox']",
      "[role='option']",
      "[data-suspend-calendar-hotkeys='true']",
    ].join(", "));
}

function isGridOriginFloatingDetail(detail) {
  if (!detail?.open || detail.mode !== "detail" || detail.parked || detail.userDragged) return false;
  return isGridOriginAnchorKind(detail.anchorKind);
}

function placementSideFromCaret(caretSide) {
  if (caretSide === "left") return "right";
  if (caretSide === "right") return "left";
  return null;
}

function isGridOriginAnchorKind(anchorKind) {
  return ["chip", "span", "overflow-row"].includes(String(anchorKind || ""));
}

function preservedReanchorSide(current, nextDetail, nextView, nextDateKey) {
  if (!current?.open || current.mode !== "detail" || current.parked || current.userDragged || current.dirty) return null;
  if (current.view !== nextView || current.dateKey !== nextDateKey) return null;
  if (!isGridOriginAnchorKind(current.anchorKind) || !isGridOriginAnchorKind(nextDetail.anchorKind)) return null;
  return current.forcedSide
    || placementSideFromCaret(current.initialPlacement?.caretSide)
    || current.preferredSide
    || null;
}

function rememberedSessionSide(sessionSideByViewRef, nextDetail, nextView) {
  if (!isGridOriginAnchorKind(nextDetail.anchorKind)) return null;
  return sessionSideByViewRef.current[nextView] || null;
}

function floatingDetailTypeLabel(view) {
  if (view === "events") return "Event";
  if (view === "bills") return "Bill";
  if (view === "deadlines") return "Deadline";
  return "Item";
}

function formatFloatingDetailLabel(view, dateKey, viewYear, viewMonth, selectedDay) {
  const parsed = parseYmd(dateKey);
  const date = parsed
    ? new Date(parsed.year, parsed.month, parsed.day)
    : selectedDay
      ? new Date(viewYear, viewMonth, selectedDay)
      : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Selected";
  return `${floatingDetailTypeLabel(view)} · ${dateLabel}`;
}

function formatFloatingEditorLabel(mode, view, dateKey, viewYear, viewMonth, selectedDay) {
  const parsed = parseYmd(dateKey);
  const date = parsed
    ? new Date(parsed.year, parsed.month, parsed.day)
    : selectedDay
      ? new Date(viewYear, viewMonth, selectedDay)
      : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Selected";
  const action = mode === "create" ? "New" : "Edit";
  const type = floatingDetailTypeLabel(view).toLowerCase();
  return `${action} ${type} · ${dateLabel}`;
}

function elementRect(element) {
  return element?.isConnected ? element.getBoundingClientRect() : null;
}

function pacificDateKeyFromMs(ms) {
  if (!ms) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
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
  const [floatingDetail, setFloatingDetail] = useState(null);
  const [deadlineEditor, setDeadlineEditor] = useState(() => (
    open && view === "deadlines" && focusItemId === "new"
      ? { mode: "create", seedDate: focusDate || null }
      : null
  ));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState(null);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [agendaScrollCommand, setAgendaScrollCommand] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const floatingDetailRef = useRef(null);
  const floatingDetailSessionSideByViewRef = useRef({});
  const agendaRailRef = useRef(null);
  const agendaPassiveSyncSuppressedUntilRef = useRef(0);
  const handledInitialDeadlineCreateRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const resizeRafRef = useRef(0);
  const [monthMotionDirection, setMonthMotionDirection] = useState(0);

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const activeView = VIEWS[view] || billsView;
  const activeLayout = getCalendarLayoutMetrics(viewportWidth);
  const usesFloatingEditor = !activeLayout.stacked;

  useLayoutEffect(() => {
    floatingDetailRef.current = floatingDetail;
  }, [floatingDetail]);

  useEffect(() => {
    if (open) return;
    floatingDetailSessionSideByViewRef.current = {};
  }, [open]);

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

  const handleEventEditorSaved = useCallback((savedEvent) => {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "events" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (current.saveRequestId && current.saveRequestId !== current.activeSaveRequestId) return;
    if (!savedEvent?.id) {
      setFloatingDetail(null);
      return;
    }
    const dateKey = savedEvent.startMs ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(savedEvent.startMs)) : current.dateKey;
    const parsed = parseYmd(dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(savedEvent) : savedEvent.id;
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(String(itemId));
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId: String(itemId),
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [savedEvent],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }, [activeView, setSelectedDateKey, setSelectedDay, setSelectedItemId]);

  const handleEventEditorDeleted = useCallback((deletedEvent) => {
    const current = floatingDetailRef.current;
    if (current?.open && current.view === "events") {
      setFloatingDetail(null);
    }
    const deletedId = deletedEvent && activeView.getItemId
      ? activeView.getItemId(deletedEvent)
      : deletedEvent?.id;
    if (deletedId != null && String(selectedItemId) === String(deletedId)) {
      setSelectedItemId(null);
    }
  }, [activeView, selectedItemId, setSelectedItemId]);

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
  function suppressAgendaPassiveSync(durationMs = 900) {
    agendaPassiveSyncSuppressedUntilRef.current = Math.max(
      agendaPassiveSyncSuppressedUntilRef.current,
      performance.now() + durationMs,
    );
  }

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

  function openFloatingEventCreate(seedDate = null) {
    suppressAgendaPassiveSync();
    const dateKey = seedDate || activeSelectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay });
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(null);
    eventEditor.openCreate?.();
    openFloatingDetail({
      mode: "create",
      view: "events",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: findDateCell(dateKey),
      sourceCellElement: findDateCell(dateKey),
      anchorKind: "day-cell",
      parked: !findDateCell(dateKey),
    });
  }

  function openFloatingEventEdit(item, options = {}) {
    if (!item?.writable) return;
    suppressAgendaPassiveSync();
    const itemId = activeView.getItemId ? activeView.getItemId(item) : item.id;
    const dateKey = options.dateKey || pacificDateKeyFromMs(item.startMs) || activeSelectedDateKey;
    const fallbackCell = findDateCell(dateKey);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(itemId != null ? String(itemId) : null);
    eventEditor.openEdit?.(item);
    const current = floatingDetailRef.current;
    const reuseCurrentAnchor = current?.open
      && current.view === "events"
      && String(current.itemId) === String(itemId)
      && !current.parked;
    openFloatingDetail({
      mode: "edit",
      view: "events",
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : fallbackCell ? "day-cell" : "parked"),
      parked: options.parked ?? (!options.anchorElement && !reuseCurrentAnchor && !fallbackCell),
      itemsSnapshot: [item],
    });
  }

  function openFloatingDeadlineCreate(seedDate = null) {
    const dateKey = seedDate || activeSelectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay });
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(null);
    setDeadlineEditor({ mode: "create", seedDate: dateKey || null });
    setDeadlineDraftPreview(null);
    openFloatingDetail({
      mode: "create",
      view: "deadlines",
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: findDateCell(dateKey),
      sourceCellElement: findDateCell(dateKey),
      anchorKind: "day-cell",
      parked: !findDateCell(dateKey),
    });
  }

  function openFloatingDeadlineEdit(task, options = {}) {
    if (task?.source !== "todoist") return;
    const itemId = String(task.id);
    const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
    const fallbackCell = findDateCell(dateKey);
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(itemId);
    setDeadlineEditor({ mode: "edit", taskId: itemId });
    setDeadlineDraftPreview(null);
    const current = floatingDetailRef.current;
    const reuseCurrentAnchor = current?.open
      && current.view === "deadlines"
      && String(current.itemId) === itemId
      && !current.parked;
    openFloatingDetail({
      mode: "edit",
      view: "deadlines",
      itemId,
      dateKey,
      day: parsed?.day ?? null,
      anchorElement: options.anchorElement || (reuseCurrentAnchor ? current.anchorElement : null) || fallbackCell,
      sourceCellElement: options.sourceCellElement || (reuseCurrentAnchor ? current.sourceCellElement : null) || fallbackCell,
      exclusionElement: options.exclusionElement || null,
      anchorKind: options.anchorKind || (reuseCurrentAnchor ? current.anchorKind : fallbackCell ? "day-cell" : "parked"),
      parked: options.parked ?? (!options.anchorElement && !reuseCurrentAnchor && !fallbackCell),
      itemsSnapshot: [task],
    });
  }

  function cancelFloatingEditor() {
    const current = floatingDetailRef.current;
    if (!current?.open || (current.mode !== "edit" && current.mode !== "create")) return;
    if (current.view === "events") {
      eventEditor.closeEditor?.();
    }
    if (current.view === "deadlines") {
      setDeadlineEditor(null);
      setDeadlineDraftPreview(null);
    }
    if (current.mode === "create") {
      setFloatingDetail(null);
      return;
    }
    setFloatingDetail({
      ...current,
      mode: "detail",
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }

  function handleFloatingDeadlineSaved(task) {
    const current = floatingDetailRef.current;
    if (!current?.open || current.view !== "deadlines" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (!task?.id) {
      setFloatingDetail(null);
      return;
    }
    const dateKey = task.due_date || current.dateKey || activeSelectedDateKey;
    const parsed = parseYmd(dateKey);
    if (parsed) {
      setSelectedDay(parsed.day);
      setSelectedDateKey(dateKey);
    }
    setSelectedItemId(String(task.id));
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail({
      ...current,
      mode: "detail",
      itemId: String(task.id),
      dateKey,
      day: parsed?.day ?? current.day ?? null,
      itemsSnapshot: [task],
      editorSessionId: null,
      saveRequestId: null,
      activeSaveRequestId: null,
      dirty: false,
    });
  }

  function handleFloatingDeadlineDeleted(taskId) {
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
    setFloatingDetail(null);
    if (String(selectedItemId) === String(taskId)) {
      setSelectedItemId(null);
    }
  }

  function closeFloatingDetail() {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (current.dirty) shakeFloatingEditor();
      return;
    }
    setFloatingDetail(null);
  }

  function shakeFloatingEditor() {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, shakeKey: (current.shakeKey || 0) + 1 }
        : current
    ));
  }

  function setFloatingEditorDirty(dirty) {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty !== !!dirty
        ? { ...current, dirty: !!dirty }
        : current
    ));
  }

  function setFloatingEditorSaveRequest(requestId) {
    setFloatingDetail((current) => (
      current?.open && (current.mode === "edit" || current.mode === "create")
        ? { ...current, saveRequestId: requestId, activeSaveRequestId: requestId }
        : current
    ));
  }

  function findDateCell(dateKey) {
    if (!dateKey) return null;
    return panelRef.current?.querySelector?.(`[role='gridcell'][data-date-key='${dateKey}']`) || null;
  }

  function openFloatingDetail(nextDetail) {
    if (!nextDetail) return;
    const mode = nextDetail.mode || "detail";
    const nextView = nextDetail.view || view;
    const nextDateKey = nextDetail.dateKey || null;
    const suppliedAnchor = nextDetail.anchorElement || null;
    const inferredDayCell = !suppliedAnchor && mode !== "detail" ? findDateCell(nextDateKey) : null;
    const anchorElement = suppliedAnchor || inferredDayCell;
    const parked = !!nextDetail.parked || !anchorElement;
    if (mode === "detail" && (!nextDetail.itemId || !anchorElement)) return;
    const preferredSide = nextDetail.preferredSide
      || (String(nextDetail.anchorKind || "").startsWith("agenda") ? "left" : null);
    setFloatingDetail((current) => {
      const forcedSide = nextDetail.forcedSide
        || preservedReanchorSide(current, nextDetail, nextView, nextDateKey)
        || rememberedSessionSide(floatingDetailSessionSideByViewRef, nextDetail, nextView)
        || null;
      const initialPlacement = resolveFloatingDetailPlacement({
        anchorRect: elementRect(anchorElement),
        sourceRect: elementRect(nextDetail.sourceCellElement || inferredDayCell),
        exclusionRect: elementRect(nextDetail.exclusionElement),
        calendarRect: elementRect(panelRef.current),
        panelHeight: mode === "detail" ? 300 : 560,
        mode,
        parked,
        preferredSide,
        forcedSide,
      });
      const nextItemId = nextDetail.itemId != null ? String(nextDetail.itemId) : null;
      const canReuseSnapshot = current?.open
        && String(current.itemId) === nextItemId
        && current.view === nextView
        && current.dateKey === nextDateKey
        && Array.isArray(current.itemsSnapshot);
      const isSameSession = current?.open
        && current.mode === mode
        && current.view === nextView
        && String(current.itemId || "") === String(nextItemId || "")
        && current.dateKey === nextDateKey;
      return {
        open: true,
        mode,
        placementKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        view: nextView,
        itemId: nextItemId,
        dateKey: nextDateKey,
        day: nextDetail.day ?? null,
        anchorElement,
        sourceCellElement: nextDetail.sourceCellElement || inferredDayCell || null,
        exclusionElement: nextDetail.exclusionElement || null,
        anchorKind: parked ? "parked" : nextDetail.anchorKind || (inferredDayCell ? "day-cell" : "chip"),
        preferredSide,
        forcedSide,
        parked,
        userDragged: false,
        initialPlacement,
        itemsSnapshot: Array.isArray(nextDetail.itemsSnapshot)
          ? nextDetail.itemsSnapshot
          : canReuseSnapshot
            ? current.itemsSnapshot
            : null,
        editorSessionId: mode === "edit" || mode === "create"
          ? isSameSession
            ? current.editorSessionId
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
          : null,
        saveRequestId: null,
        activeSaveRequestId: null,
        dirty: false,
        shakeKey: current?.shakeKey || 0,
      };
    });
  }

  function parkFloatingDetail() {
    setFloatingDetail((current) => (
      current?.open
        ? {
            ...current,
            anchorElement: null,
            sourceCellElement: null,
            exclusionElement: null,
            anchorKind: "parked",
            parked: true,
            userDragged: false,
            forcedSide: null,
          }
        : current
    ));
  }

  function setFloatingDetailDragged(userDragged, placementKey = null) {
    if (userDragged) {
      const currentView = floatingDetailRef.current?.view;
      if (currentView) delete floatingDetailSessionSideByViewRef.current[currentView];
    }
    setFloatingDetail((current) => (
      current?.open && (!userDragged || !placementKey || current.placementKey === placementKey)
        ? {
            ...current,
            userDragged: !!userDragged,
            forcedSide: userDragged ? null : current.forcedSide || null,
          }
        : current
    ));
  }

  function flipFloatingDetailSide() {
    const currentDetail = floatingDetailRef.current;
    if (!isGridOriginFloatingDetail(currentDetail) || currentDetail.dirty) return;
    setFloatingDetail((current) => {
      if (!isGridOriginFloatingDetail(current) || current.dirty) return current;
      const currentSide = current.forcedSide
        || placementSideFromCaret(current.initialPlacement?.caretSide)
        || current.preferredSide
        || "right";
      const forcedSide = currentSide === "left" ? "right" : "left";
      floatingDetailSessionSideByViewRef.current = {
        ...floatingDetailSessionSideByViewRef.current,
        [current.view]: forcedSide,
      };
      return {
        ...current,
        forcedSide,
      };
    });
  }

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
  }, [onViewChange, setFloatingDetail, view]);

  const closeCalendarModal = useCallback(() => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return;
    }
    setFloatingDetail(null);
    setSuppressFocusRing(false);
    onClose();
  }, [onClose, setFloatingDetail, setSuppressFocusRing]);

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

  const suppressOutsideClickRef = useRef(new Map());
  function suppressOutsideClick(test, key = "default") {
    if (test) {
      suppressOutsideClickRef.current.set(key, test);
    } else {
      suppressOutsideClickRef.current.delete(key);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (open) return;
    suppressOutsideClickRef.current.clear();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event) {
      const suppressors = [...suppressOutsideClickRef.current.values()];
      if (suppressors.some((test) => test?.(event.target))) return;
      if (isFloatingDetailPanelTarget(event.target)) return;
      const roleLayer = event.target.closest?.('[role="menu"], [role="dialog"], [role="listbox"]');
      if (roleLayer && !panelRef.current?.contains(roleLayer)) return;
      if (floatingDetail?.open) {
        if (floatingDetail.mode === "edit" || floatingDetail.mode === "create") {
          if (floatingDetail.dirty && !isFloatingDetailTriggerTarget(event.target)) {
            shakeFloatingEditor();
          }
          return;
        }
        if (!isFloatingDetailTriggerTarget(event.target)) {
          setFloatingDetail(null);
          return;
        }
        return;
      }
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        closeCalendarModal();
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [closeCalendarModal, floatingDetail?.dirty, floatingDetail?.mode, floatingDetail?.open, open]);

  useEffect(() => {
    function handleResize() {
      if (resizeRafRef.current) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        setViewportWidth((current) => (
          current === window.innerWidth ? current : window.innerWidth
        ));
      });
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeRafRef.current) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !open) return undefined;
    function onWheel(event) {
      const localScrollElement = event.target instanceof HTMLElement
        ? event.target.closest("[data-calendar-local-scroll='true']")
        : null;
      if (localScrollElement && localScrollElement !== element) {
        const localMaxScroll = localScrollElement.scrollHeight - localScrollElement.clientHeight;
        if (localMaxScroll > 0) {
          const localAtTop = localScrollElement.scrollTop <= 0 && event.deltaY < 0;
          const localAtBottom = localScrollElement.scrollTop >= localMaxScroll && event.deltaY > 0;
          if (!localAtTop && !localAtBottom) return;
        }
      }

      const { scrollTop, scrollHeight, clientHeight } = element;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        event.preventDefault();
        return;
      }
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop >= maxScroll && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open]);

  const computed = useMemo(
    () => activeView.compute({ data: viewData, viewYear, viewMonth }),
    [activeView, viewData, viewYear, viewMonth],
  );
  const itemsByDay = useMemo(() => computed.itemsByDay || {}, [computed.itemsByDay]);
  const ghostPreview = useCalendarGhostPreview({
    open,
    view,
    viewData,
    computed,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    viewYear,
    viewMonth,
    setMonthMotionDirection,
    setViewDate,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
  });

  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const trailingEmpty = 42 - (firstDay + daysInMonth);
  const canGoPrev = activeView.canNavigateBack
    ? activeView.canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data: viewData, computed })
    : !isCurrentMonth;

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event) {
      if (event.key === "Tab") {
        setSuppressFocusRing(false);
        return;
      }

      const consumeCalendarKey = ({ preventDefault = true } = {}) => {
        setSuppressFocusRing(true);
        if (preventDefault && event.cancelable) event.preventDefault();
        event.stopPropagation();
      };

      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        consumeCalendarKey();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape" && floatingDetail?.open) {
        if (floatingDetail.mode === "edit" || floatingDetail.mode === "create") {
          cancelFloatingEditor();
        } else {
          setFloatingDetail(null);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Escape" && view === "deadlines" && deadlineEditor?.mode) {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (isSuspendedHotkeyTarget(event.target)) return;

      if (isEditableTarget(event.target)) {
        if (event.key === "Escape") {
          closeCalendarModal();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === " ") {
        const currentDetail = floatingDetailRef.current;
        if (isGridOriginFloatingDetail(currentDetail)
          && !currentDetail.dirty
          && !isFloatingDetailFlipSuppressedTarget(event.target, currentDetail)
        ) {
          flipFloatingDetailSide();
          consumeCalendarKey();
          return;
        }
      }

      if (
        (event.key === "Enter" || event.key === " ")
        && event.target instanceof HTMLElement
        && event.target.closest("button, [role='button'], [role='gridcell']")
      ) {
        setSuppressFocusRing(true);
        return;
      }

      switch (event.key) {
        case "Escape":
          closeCalendarModal();
          consumeCalendarKey({ preventDefault: false });
          break;
        case "ArrowLeft":
        case "p":
          if (canGoPrev) navigateMonthRef.current?.(-1);
          consumeCalendarKey();
          break;
        case "ArrowRight":
        case "n":
          navigateMonthRef.current?.(1);
          consumeCalendarKey();
          break;
        case "t":
        case "T":
          if (floatingDetailRef.current?.open
            && (floatingDetailRef.current.mode === "edit" || floatingDetailRef.current.mode === "create")
            && floatingDetailRef.current.dirty
          ) {
            shakeFloatingEditor();
            consumeCalendarKey();
            break;
          }
          if (eventEditor.isEditorOpen && eventEditor.isDirty) {
            shakeFloatingEditor();
            consumeCalendarKey();
            break;
          }
          closeEventEditor();
          setFloatingDetail(null);
          setDeadlineEditor(null);
          setDeadlineDraftPreview(null);
          setViewDate({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          setSelectedDateKey(ymdFromParts(currentYear, currentMonth, todayDate));
          setSelectedItemId(null);
          requestAgendaScroll({ type: "today" });
          consumeCalendarKey();
          break;
        case "e":
        case "E":
          if (selectedItemId != null) {
            if (view === "events" && eventEditor.editable) {
              const dayItems = computed.itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay] || [];
              const resolveId = activeView.getItemId;
              const ev = dayItems.find((item) => String(resolveId(item)) === String(selectedItemId));
              if (ev) {
                if (usesFloatingEditor) {
                  openFloatingEventEdit(ev, { dateKey: selectedDateKey });
                } else {
                  setFloatingDetail(null);
                  eventEditor.openEdit(ev);
                }
              }
            } else if (view === "deadlines") {
              const dayState = computed.itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay];
              const pool = dayState?.items || dayState || [];
              const task = (Array.isArray(pool) ? pool : []).find((t) => String(t?.id) === String(selectedItemId));
              if (task?.source === "todoist") {
                if (usesFloatingEditor) {
                  openFloatingDeadlineEdit(task, { dateKey: selectedDateKey });
                } else {
                  setFloatingDetail(null);
                  setDeadlineEditor({ mode: "edit", taskId: String(selectedItemId) });
                  setDeadlineDraftPreview(null);
                }
              }
            }
          }
          consumeCalendarKey();
          break;
        case "c":
        case "C":
          if (view === "events" && eventEditor.editable) {
            if (usesFloatingEditor) {
              openFloatingEventCreate(selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }));
            } else {
              setFloatingDetail(null);
              eventEditor.openCreate();
            }
          } else if (view === "deadlines") {
            if (usesFloatingEditor) {
              openFloatingDeadlineCreate(selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }));
            } else {
              setFloatingDetail(null);
              setDeadlineEditor({
                mode: "create",
                seedDate: selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }),
              });
              setDeadlineDraftPreview(null);
            }
          }
          consumeCalendarKey();
          break;
        case "1":
          if (view !== "events") handleViewChange("events");
          consumeCalendarKey();
          break;
        case "2":
          if (view !== "bills") handleViewChange("bills");
          consumeCalendarKey();
          break;
        case "3":
          if (view !== "deadlines") handleViewChange("deadlines");
          consumeCalendarKey();
          break;
        default:
          if (event.key === "Enter" || (event.key.length === 1 && event.key !== " " && event.key !== "r" && event.key !== "R")) {
            consumeCalendarKey();
          }
          break;
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
    // The editor routing helpers intentionally read the latest modal refs inside this document listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canGoPrev, currentMonth, currentYear, todayDate, view, viewYear, viewMonth, closeCalendarModal, closeEventEditor, eventEditor, deadlineEditor, selectedItemId, selectedDay, selectedDateKey, activeView, itemsByDay, computed.itemsByDate, setDeadlineEditor, floatingDetail?.open, floatingDetail?.mode, handleViewChange, usesFloatingEditor]);

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
  }, [eventEditor.isEditorOpen]);

  if (!open) return null;

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" });
  const monthYear = String(viewYear);
  const layout = activeLayout;
  const panelWidth = layout.panelWidth || `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const showEventsLoading = view === "events" && viewData?.isLoading && (computed?.totalEvents || 0) === 0;
  const showDeadlinesLoadingState = view === "deadlines" && !!viewData?.isLoading;
  const showGridSkeleton = showEventsLoading || showDeadlinesLoadingState;

  const selectedDayRawItems = activeSelectedDay != null
    ? (computed.itemsByDate?.[activeSelectedDateKey] ?? itemsByDay[activeSelectedDay])
    : [];
  const selectedDayState = activeSelectedDay != null
    ? (activeView.getDayState?.(selectedDayRawItems) ?? buildFallbackDayState(selectedDayRawItems))
    : buildFallbackDayState([]);
  const selectedItems = activeView.getDayState ? selectedDayState : selectedDayState.items;
  const effectiveSelectedItemId = (() => {
    if (activeSelectedDay == null || selectedDayState.totalCount === 0) return null;
    if (activeSelectedItemId == null) return null;
    if (!activeView.getItemId) return activeSelectedItemId;

    const pool = view === "deadlines"
      ? [...selectedDayState.activeItems, ...selectedDayState.completedItems]
      : Array.isArray(selectedItems)
        ? selectedItems
        : selectedDayState.items || [];
    const resolveItemId = activeView.getItemId;
    const hasSelectedItem = pool.some((item) => String(resolveItemId(item)) === String(activeSelectedItemId));
    return hasSelectedItem ? String(activeSelectedItemId) : null;
  })();
  const hasSelectedDay = activeSelectedDay != null;
  const showDeadlineEditor = view === "deadlines" && !!deadlineEditor;
  const showDetail = view === "deadlines"
    ? showDeadlineEditor || (!showDeadlinesLoadingState && hasSelectedDay && selectedDayState.totalCount > 0)
    : hasSelectedDay && selectedDayState.totalCount > 0;
  const showEmptySelection = view === "deadlines"
    ? hasSelectedDay && selectedDayState.totalCount === 0 && !showDeadlineEditor && !showDeadlinesLoadingState
    : hasSelectedDay && selectedDayState.totalCount === 0;
  const floatingDetailLabel = floatingDetail?.open
    ? (floatingDetail.mode === "edit" || floatingDetail.mode === "create"
        ? formatFloatingEditorLabel(
            floatingDetail.mode,
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
          )
        : formatFloatingDetailLabel(
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
          ))
    : "";

  return (
    <CalendarModalShell
      panelRef={panelRef}
      scrollRef={scrollRef}
      panelWidth={panelWidth}
      layout={layout}
      view={view}
      monthName={monthName}
      monthYear={monthYear}
      canGoPrev={canGoPrev}
      navigateMonth={navigateMonth}
      monthMotionDirection={monthMotionDirection}
      onViewChange={handleViewChange}
      HeaderExtras={activeView.HeaderExtras}
      viewData={viewData}
      weatherData={weatherData}
      computed={computed}
      suppressOutsideClick={suppressOutsideClick}
      eventEditor={eventEditor}
      selectedDay={activeSelectedDay}
      selectedDateKey={activeSelectedDateKey}
      viewYear={viewYear}
      viewMonth={viewMonth}
      setDeadlineEditor={setDeadlineEditor}
      onClose={closeCalendarModal}
      activeView={activeView}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayDate={todayDate}
      firstDay={firstDay}
      daysInMonth={daysInMonth}
      trailingEmpty={trailingEmpty}
      itemsByDay={itemsByDay}
      itemsByDate={computed.itemsByDate || {}}
      showGridSkeleton={showGridSkeleton}
      buildFallbackDayState={buildFallbackDayState}
      closeEventEditor={closeEventEditor}
      setSelectedDay={setSelectedDay}
      setSelectedDateKey={setSelectedDateKey}
      setSelectedItemId={setSelectedItemId}
      eventQuickActions={eventQuickActions}
      deadlineQuickActions={deadlineQuickActions}
      agendaRailRef={agendaRailRef}
      agendaScrollCommand={agendaScrollCommand}
      onAgendaPassiveDateChange={(dateKey) => selectAgendaDate(dateKey, { passive: true })}
      onAgendaDateAction={(dateKey) => selectAgendaDate(dateKey)}
      onAgendaEventAction={selectAgendaEvent}
      onAgendaDirtyBlocked={shakeFloatingEditor}
      onGridDateAction={scrollAgendaToDate}
      onGridEventAction={scrollAgendaToEvent}
      showDetail={showDetail}
      showEmptySelection={showEmptySelection}
      effectiveSelectedItemId={effectiveSelectedItemId}
      selectedDayState={selectedDayState}
      selectedItems={selectedItems}
      deadlineEditor={deadlineEditor}
      focusDeadlineTask={focusDeadlineTask}
      ghostPreview={ghostPreview}
      onDeadlineDraftPreviewChange={setDeadlineDraftPreview}
      floatingDetail={floatingDetail}
      floatingDetailLabel={floatingDetailLabel}
      onOpenFloatingDetail={openFloatingDetail}
      onCloseFloatingDetail={closeFloatingDetail}
      onParkFloatingDetail={parkFloatingDetail}
      onFloatingDetailDragged={setFloatingDetailDragged}
      onReanchorFloatingDetail={openFloatingDetail}
      onOpenFloatingEventCreate={openFloatingEventCreate}
      onOpenFloatingEventEdit={openFloatingEventEdit}
      onOpenFloatingDeadlineCreate={openFloatingDeadlineCreate}
      onOpenFloatingDeadlineEdit={openFloatingDeadlineEdit}
      onCancelFloatingEditor={cancelFloatingEditor}
      onFloatingEditorDirtyChange={setFloatingEditorDirty}
      onFloatingEditorSaveRequest={setFloatingEditorSaveRequest}
      onShakeFloatingEditor={shakeFloatingEditor}
      onFloatingDeadlineSaved={handleFloatingDeadlineSaved}
      onFloatingDeadlineDeleted={handleFloatingDeadlineDeleted}
      suppressFocusRing={suppressFocusRing}
    />
  );
}
