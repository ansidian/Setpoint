import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "./views/billsView.jsx";
import deadlinesView from "./views/deadlinesView.jsx";
import eventsView from "./views/eventsView.jsx";
import { getCalendarLayoutMetrics } from "./calendarLayout.js";
import useCalendarEventEditor from "./events/useCalendarEventEditor.js";
import useCalendarQuickActions from "./events/useCalendarQuickActions.js";
import useCalendarGhostPreview from "./useCalendarGhostPreview.js";
import CalendarModalShell from "./modal/CalendarModalShell.jsx";
import { resolveFloatingDetailPlacement } from "./modal/calendarFloatingDetailPlacement.js";
import {
  getMonthData,
  getVisibleGridRange,
  parseYmd,
  ymdFromParts,
} from "./calendarDateUtils.js";

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

function parseFocusDate(focusDate) {
  if (!focusDate) return null;
  const date = new Date(`${focusDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function ymdFromView({ viewYear, viewMonth, selectedDay }) {
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
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

function isSameViewDate(a, b) {
  return a?.month === b?.month && a?.year === b?.year;
}

function isFloatingDetailTriggerTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-testid='calendar-cell-item-chip'], [data-testid='calendar-cell-overflow-item'], [data-testid='calendar-event-span-segment']");
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

function elementRect(element) {
  return element?.isConnected ? element.getBoundingClientRect() : null;
}

export default function CalendarModal({
  open,
  onClose,
  view,
  onViewChange,
  eventsData,
  billsData,
  deadlinesData,
  focusDate,
  focusItemId,
  openRequestId = 0,
}) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const initialFocus = open ? parseFocusDate(focusDate) : null;

  const [viewDate, setViewDate] = useState(() => (
    initialFocus
      ? { month: initialFocus.getMonth(), year: initialFocus.getFullYear() }
      : { month: currentMonth, year: currentYear }
  ));
  const [selectedDay, setSelectedDay] = useState(() => (initialFocus ? initialFocus.getDate() : null));
  const [selectedDateKey, setSelectedDateKey] = useState(() => (initialFocus ? ymdFromParts(initialFocus.getFullYear(), initialFocus.getMonth(), initialFocus.getDate()) : null));
  const [selectedItemId, setSelectedItemId] = useState(() => (open && focusItemId ? String(focusItemId) : null));
  const [floatingDetail, setFloatingDetail] = useState(null);
  const [deadlineEditor, setDeadlineEditor] = useState(() => (
    open && view === "deadlines" && focusItemId === "new"
      ? { mode: "create", seedDate: focusDate || null }
      : null
  ));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pendingFocusDate, setPendingFocusDate] = useState(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null);
  const [deadlineDraftPreview, setDeadlineDraftPreview] = useState(null);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const resizeRafRef = useRef(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevView, setPrevView] = useState(view);
  const [prevOpenRequestId, setPrevOpenRequestId] = useState(openRequestId);
  const [monthMotionDirection, setMonthMotionDirection] = useState(0);

  const syncSnapshot = useMemo(() => {
    const didOpen = !prevOpen && open;
    const didViewChange = prevView !== view;
    const didOpenRequest = open && prevOpenRequestId !== openRequestId;

    if (!didOpen && !didViewChange && !didOpenRequest) return null;

    let nextViewDate = viewDate;
    let nextSelectedDay = selectedDay;
    let nextSelectedDateKey = selectedDateKey;
    let nextSelectedItemId = selectedItemId;
    let nextPendingFocusDate = pendingFocusDate;
    let nextPendingFocusItemId = pendingFocusItemId;
    const openingFocus = didOpen ? parseFocusDate(focusDate) : null;
    const requestFocus = didOpenRequest ? parseFocusDate(focusDate) : null;

    if (didOpen) {
      nextPendingFocusDate = focusDate || null;
      nextPendingFocusItemId = focusItemId ? String(focusItemId) : null;

      if (openingFocus) {
        nextViewDate = { month: openingFocus.getMonth(), year: openingFocus.getFullYear() };
        nextSelectedDay = openingFocus.getDate();
        nextSelectedDateKey = ymdFromParts(openingFocus.getFullYear(), openingFocus.getMonth(), openingFocus.getDate());
        nextSelectedItemId = focusItemId ? String(focusItemId) : null;
      } else {
        const today = new Date();
        nextViewDate = { month: today.getMonth(), year: today.getFullYear() };
        nextSelectedDay = today.getDate();
        nextSelectedDateKey = ymdFromParts(today.getFullYear(), today.getMonth(), today.getDate());
        nextSelectedItemId = null;
      }
    }

    if (didOpenRequest && !didOpen) {
      nextPendingFocusDate = focusDate || null;
      nextPendingFocusItemId = focusItemId ? String(focusItemId) : null;

      if (requestFocus) {
        nextViewDate = { month: requestFocus.getMonth(), year: requestFocus.getFullYear() };
        nextSelectedDay = requestFocus.getDate();
        nextSelectedDateKey = ymdFromParts(requestFocus.getFullYear(), requestFocus.getMonth(), requestFocus.getDate());
        nextSelectedItemId = focusItemId ? String(focusItemId) : null;
      } else if (focusItemId) {
        nextSelectedItemId = String(focusItemId);
      }
    }

    if (didViewChange) {
      const pendingFocus = openingFocus || requestFocus || parseFocusDate(nextPendingFocusDate);
      const nextFocusedItemId = openingFocus
        ? (focusItemId ? String(focusItemId) : null)
        : requestFocus
          ? (focusItemId ? String(focusItemId) : null)
          : (nextPendingFocusItemId ? String(nextPendingFocusItemId) : null);

      if (pendingFocus) {
        nextViewDate = { month: pendingFocus.getMonth(), year: pendingFocus.getFullYear() };
        nextSelectedDay = pendingFocus.getDate();
        nextSelectedDateKey = ymdFromParts(pendingFocus.getFullYear(), pendingFocus.getMonth(), pendingFocus.getDate());
        nextSelectedItemId = nextFocusedItemId;
        nextPendingFocusDate = null;
        nextPendingFocusItemId = null;
      }
    }

    return {
      didViewChange,
      resetDeadlineEditor: didOpen || didViewChange,
      nextViewDate,
      nextSelectedDay,
      nextSelectedDateKey,
      nextSelectedItemId,
      nextPendingFocusDate,
      nextPendingFocusItemId,
      openCreate: (didOpen || didOpenRequest) && focusItemId === "new",
    };
  }, [open, view, prevOpen, prevView, prevOpenRequestId, openRequestId, focusDate, focusItemId, viewDate, selectedDay, selectedDateKey, selectedItemId, pendingFocusDate, pendingFocusItemId]);

  const activeViewDate = syncSnapshot?.nextViewDate || viewDate;
  const activeSelectedDay = syncSnapshot ? syncSnapshot.nextSelectedDay : selectedDay;
  const activeSelectedDateKey = syncSnapshot ? syncSnapshot.nextSelectedDateKey : selectedDateKey;
  const activeSelectedItemId = syncSnapshot ? syncSnapshot.nextSelectedItemId : selectedItemId;

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const activeView = VIEWS[view] || billsView;

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
        hasMonth: eventsData?.hasMonth?.(viewYear, viewMonth) || false,
      };
    }
    if (view === "deadlines") return deadlinesData;
    return billsData;
  }, [view, eventsData, viewYear, viewMonth, deadlinesData, billsData]);

  function focusEditorDate(ymd) {
    const focus = parseFocusDate(ymd);
    if (!focus) return;
    setViewDate({ month: focus.getMonth(), year: focus.getFullYear() });
    setSelectedDay(focus.getDate());
    setSelectedDateKey(ymdFromParts(focus.getFullYear(), focus.getMonth(), focus.getDate()));
  }

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
    },
  });

  function closeFloatingDetail() {
    setFloatingDetail(null);
  }

  function openFloatingDetail(nextDetail) {
    if (!nextDetail?.itemId || !nextDetail?.anchorElement) return;
    const initialPlacement = resolveFloatingDetailPlacement({
      anchorRect: elementRect(nextDetail.anchorElement),
      sourceRect: elementRect(nextDetail.sourceCellElement),
      exclusionRect: elementRect(nextDetail.exclusionElement),
      calendarRect: elementRect(panelRef.current),
      panelHeight: 300,
      parked: false,
    });
    setFloatingDetail((current) => {
      const nextView = nextDetail.view || view;
      const nextItemId = String(nextDetail.itemId);
      const nextDateKey = nextDetail.dateKey || null;
      const canReuseSnapshot = current?.open
        && String(current.itemId) === nextItemId
        && current.view === nextView
        && current.dateKey === nextDateKey
        && Array.isArray(current.itemsSnapshot);
      return {
        open: true,
        placementKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        view: nextView,
        itemId: nextItemId,
        dateKey: nextDateKey,
        day: nextDetail.day ?? null,
        anchorElement: nextDetail.anchorElement,
        sourceCellElement: nextDetail.sourceCellElement || null,
        exclusionElement: nextDetail.exclusionElement || null,
        anchorKind: nextDetail.anchorKind || "chip",
        parked: false,
        userDragged: false,
        initialPlacement,
        itemsSnapshot: Array.isArray(nextDetail.itemsSnapshot)
          ? nextDetail.itemsSnapshot
          : canReuseSnapshot
            ? current.itemsSnapshot
            : null,
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
          }
        : current
    ));
  }

  function setFloatingDetailDragged(userDragged, placementKey = null) {
    setFloatingDetail((current) => (
      current?.open && (!userDragged || !placementKey || current.placementKey === placementKey)
        ? {
            ...current,
            userDragged: !!userDragged,
          }
        : current
    ));
  }

  const handleViewChange = useCallback((nextView) => {
    if (nextView && nextView !== view) {
      setFloatingDetail(null);
    }
    onViewChange?.(nextView);
  }, [onViewChange, setFloatingDetail, view]);

  const closeCalendarModal = useCallback(() => {
    setFloatingDetail(null);
    setSuppressFocusRing(false);
    onClose();
  }, [onClose, setFloatingDetail, setSuppressFocusRing]);

  function navigateMonth(dir) {
    closeEventEditor();
    setDeadlineDraftPreview(null);
    setMonthMotionDirection(dir > 0 ? 1 : -1);
    if (floatingDetail?.open) {
      parkFloatingDetail();
    } else {
      setSelectedDay(null);
      setSelectedDateKey(null);
      setSelectedItemId(null);
    }
    setDeadlineEditor(null);
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
    const focus = parseFocusDate(task?.due_date);
    if (focus) {
      setViewDate({ month: focus.getMonth(), year: focus.getFullYear() });
      setSelectedDay(focus.getDate());
      setSelectedDateKey(ymdFromParts(focus.getFullYear(), focus.getMonth(), focus.getDate()));
    }
    setSelectedItemId(task?.id != null ? String(task.id) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  const commitSyncSnapshot = useEffectEvent((snapshot) => {
    if (snapshot?.didViewChange) {
      closeEventEditor();
      setDeadlineDraftPreview(null);
      setFloatingDetail(null);
    }
    if (snapshot?.resetDeadlineEditor) {
      setFloatingDetail(null);
    }
    if (snapshot?.openCreate && view === "deadlines") {
      setDeadlineEditor({ mode: "create", seedDate: focusDate || null });
    } else if (snapshot?.resetDeadlineEditor) {
      setDeadlineEditor(null);
      setDeadlineDraftPreview(null);
    }
    if (snapshot && !isSameViewDate(viewDate, snapshot.nextViewDate)) {
      setViewDate(snapshot.nextViewDate);
    }
    if (snapshot && selectedDay !== snapshot.nextSelectedDay) {
      setSelectedDay(snapshot.nextSelectedDay);
    }
    if (snapshot && selectedDateKey !== snapshot.nextSelectedDateKey) {
      setSelectedDateKey(snapshot.nextSelectedDateKey);
    }
    if (snapshot && selectedItemId !== snapshot.nextSelectedItemId) {
      setSelectedItemId(snapshot.nextSelectedItemId);
    }
    if (snapshot && pendingFocusDate !== snapshot.nextPendingFocusDate) {
      setPendingFocusDate(snapshot.nextPendingFocusDate);
    }
    if (snapshot && pendingFocusItemId !== snapshot.nextPendingFocusItemId) {
      setPendingFocusItemId(snapshot.nextPendingFocusItemId);
    }
    if (prevOpen !== open) {
      setPrevOpen(open);
    }
    if (prevView !== view) {
      setPrevView(view);
    }
    if (prevOpenRequestId !== openRequestId) {
      setPrevOpenRequestId(openRequestId);
    }
  });

  useLayoutEffect(() => {
    commitSyncSnapshot(syncSnapshot);
  }, [syncSnapshot, open, view, openRequestId]);

  useLayoutEffect(() => {
    if (syncSnapshot?.openCreate && view === "events" && eventEditor.editable) {
      openEventCreate();
    }
  }, [syncSnapshot?.openCreate, view, eventEditor.editable, openEventCreate]);

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
      const roleLayer = event.target.closest?.('[role="menu"], [role="dialog"], [role="listbox"]');
      if (roleLayer && !panelRef.current?.contains(roleLayer)) return;
      if (floatingDetail?.open) {
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
  }, [closeCalendarModal, floatingDetail?.open, open]);

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
  const todayDate = now.getDate();
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
        setFloatingDetail(null);
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
          closeEventEditor();
          setViewDate({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          setSelectedDateKey(ymdFromParts(currentYear, currentMonth, todayDate));
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
                setFloatingDetail(null);
                eventEditor.openEdit(ev);
              }
            } else if (view === "deadlines") {
              const dayState = computed.itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay];
              const pool = dayState?.items || dayState || [];
              const task = (Array.isArray(pool) ? pool : []).find((t) => String(t?.id) === String(selectedItemId));
              if (task?.source === "todoist") {
                setFloatingDetail(null);
                setDeadlineEditor({ mode: "edit", taskId: String(selectedItemId) });
                setDeadlineDraftPreview(null);
              }
            }
          }
          consumeCalendarKey();
          break;
        case "c":
        case "C":
          if (view === "events" && eventEditor.editable) {
            setFloatingDetail(null);
            eventEditor.openCreate();
          } else if (view === "deadlines") {
            setFloatingDetail(null);
            setDeadlineEditor({
              mode: "create",
              seedDate: selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }),
            });
            setDeadlineDraftPreview(null);
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
          if (event.key === "Enter" || (event.key.length === 1 && event.key !== "r" && event.key !== "R")) {
            consumeCalendarKey();
          }
          break;
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, canGoPrev, currentMonth, currentYear, todayDate, view, viewYear, viewMonth, closeCalendarModal, closeEventEditor, eventEditor, deadlineEditor, selectedItemId, selectedDay, selectedDateKey, activeView, itemsByDay, computed.itemsByDate, setDeadlineEditor, floatingDetail?.open, handleViewChange]);

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const { start, end } = getVisibleGridRange(viewYear, viewMonth);
    if (eventEditor.isEditorOpen) {
      const id = window.setTimeout(() => eventsData.ensureRange(start, end), 260);
      return () => window.clearTimeout(id);
    }
    eventsData.ensureRange(start, end);
  }, [open, view, viewYear, viewMonth, eventsData, eventEditor.isEditorOpen]);

  if (!open) return null;

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" });
  const monthYear = String(viewYear);
  const layout = getCalendarLayoutMetrics(viewportWidth);
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
    ? formatFloatingDetailLabel(
        floatingDetail.view || view,
        floatingDetail.dateKey || activeSelectedDateKey,
        viewYear,
        viewMonth,
        floatingDetail.day || activeSelectedDay,
      )
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
      suppressFocusRing={suppressFocusRing}
    />
  );
}
