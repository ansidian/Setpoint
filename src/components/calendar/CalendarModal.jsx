import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import billsView from "./views/billsView.jsx";
import deadlinesView from "./views/deadlinesView.jsx";
import eventsView from "./views/eventsView.jsx";
import { getCalendarLayoutMetrics } from "./calendarLayout.js";
import useCalendarEventEditor from "./events/useCalendarEventEditor.js";
import CalendarModalShell from "./modal/CalendarModalShell.jsx";

const VIEWS = {
  events: eventsView,
  bills: billsView,
  deadlines: deadlinesView,
};

function getMonthData(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

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
  const [selectedItemId, setSelectedItemId] = useState(() => (open && focusItemId ? String(focusItemId) : null));
  const [deadlineEditor, setDeadlineEditor] = useState(() => (
    open && view === "deadlines" && focusItemId === "new"
      ? { mode: "create", seedDate: focusDate || null }
      : null
  ));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pendingFocusDate, setPendingFocusDate] = useState(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const resizeRafRef = useRef(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevView, setPrevView] = useState(view);
  const [prevOpenRequestId, setPrevOpenRequestId] = useState(openRequestId);

  const syncSnapshot = useMemo(() => {
    const didOpen = !prevOpen && open;
    const didViewChange = prevView !== view;
    const didOpenRequest = open && prevOpenRequestId !== openRequestId;

    if (!didOpen && !didViewChange && !didOpenRequest) return null;

    let nextViewDate = viewDate;
    let nextSelectedDay = selectedDay;
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
        nextSelectedItemId = focusItemId ? String(focusItemId) : null;
      } else {
        const today = new Date();
        nextViewDate = { month: today.getMonth(), year: today.getFullYear() };
        nextSelectedDay = today.getDate();
        nextSelectedItemId = null;
      }
    }

    if (didOpenRequest && !didOpen) {
      nextPendingFocusDate = focusDate || null;
      nextPendingFocusItemId = focusItemId ? String(focusItemId) : null;

      if (requestFocus) {
        nextViewDate = { month: requestFocus.getMonth(), year: requestFocus.getFullYear() };
        nextSelectedDay = requestFocus.getDate();
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
      nextSelectedItemId,
      nextPendingFocusDate,
      nextPendingFocusItemId,
      openCreate: (didOpen || didOpenRequest) && focusItemId === "new",
    };
  }, [open, view, prevOpen, prevView, prevOpenRequestId, openRequestId, focusDate, focusItemId, viewDate, selectedDay, selectedItemId, pendingFocusDate, pendingFocusItemId]);

  const activeViewDate = syncSnapshot?.nextViewDate || viewDate;
  const activeSelectedDay = syncSnapshot ? syncSnapshot.nextSelectedDay : selectedDay;
  const activeSelectedItemId = syncSnapshot ? syncSnapshot.nextSelectedItemId : selectedItemId;

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const activeView = VIEWS[view] || billsView;

  const viewData = useMemo(() => {
    if (view === "events") {
      return {
        events: eventsData?.getEvents?.(viewYear, viewMonth) || [],
        isLoading: eventsData?.isMonthLoading?.(viewYear, viewMonth) || false,
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
  }

  const eventEditor = useCalendarEventEditor({
    open,
    view,
    editable: !!eventsData?.editable,
    selectedDay: activeSelectedDay,
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

  function navigateMonth(dir) {
    closeEventEditor();
    setSelectedDay(null);
    setSelectedItemId(null);
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
    }
    setSelectedItemId(task?.id != null ? String(task.id) : null);
    setDeadlineEditor(null);
  }

  const commitSyncSnapshot = useEffectEvent((snapshot) => {
    if (snapshot?.didViewChange) {
      closeEventEditor();
    }
    if (snapshot?.openCreate && view === "deadlines") {
      setDeadlineEditor({ mode: "create", seedDate: focusDate || null });
    } else if (snapshot?.resetDeadlineEditor) {
      setDeadlineEditor(null);
    }
    if (snapshot && !isSameViewDate(viewDate, snapshot.nextViewDate)) {
      setViewDate(snapshot.nextViewDate);
    }
    if (snapshot && selectedDay !== snapshot.nextSelectedDay) {
      setSelectedDay(snapshot.nextSelectedDay);
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

  const suppressOutsideClickRef = useRef(null);
  function suppressOutsideClick(test) {
    suppressOutsideClickRef.current = test;
  }

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event) {
      if (suppressOutsideClickRef.current?.(event.target)) return;
      if (event.target.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return;
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open, onClose]);

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
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape" && view === "deadlines" && deadlineEditor?.mode) {
        setDeadlineEditor(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (isSuspendedHotkeyTarget(event.target)) return;

      if (isEditableTarget(event.target)) {
        if (event.key === "Escape") {
          onClose();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      switch (event.key) {
        case "Escape":
          onClose();
          event.stopPropagation();
          break;
        case "ArrowLeft":
        case "p":
          if (canGoPrev) navigateMonthRef.current?.(-1);
          event.preventDefault();
          event.stopPropagation();
          break;
        case "ArrowRight":
        case "n":
          navigateMonthRef.current?.(1);
          event.preventDefault();
          event.stopPropagation();
          break;
        case "t":
        case "T":
          closeEventEditor();
          setViewDate({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          event.preventDefault();
          event.stopPropagation();
          break;
        case "e":
        case "E":
          if (selectedItemId != null) {
            if (view === "events" && eventEditor.editable) {
              const dayItems = itemsByDay[selectedDay] || [];
              const resolveId = activeView.getItemId;
              const ev = dayItems.find((item) => String(resolveId(item)) === String(selectedItemId));
              if (ev) eventEditor.openEdit(ev);
            } else if (view === "deadlines") {
              const dayState = itemsByDay[selectedDay];
              const pool = dayState?.items || dayState || [];
              const task = (Array.isArray(pool) ? pool : []).find((t) => String(t?.id) === String(selectedItemId));
              if (task?.source === "todoist") {
                setDeadlineEditor({ mode: "edit", taskId: String(selectedItemId) });
              }
            }
          }
          event.preventDefault();
          event.stopPropagation();
          break;
        case "c":
        case "C":
          if (view === "events" && eventEditor.editable) {
            eventEditor.openCreate();
          } else if (view === "deadlines") {
            setDeadlineEditor({ mode: "create", seedDate: null });
          }
          event.preventDefault();
          event.stopPropagation();
          break;
        case "1":
          if (view !== "events") onViewChange?.("events");
          event.preventDefault();
          event.stopPropagation();
          break;
        case "2":
          if (view !== "bills") onViewChange?.("bills");
          event.preventDefault();
          event.stopPropagation();
          break;
        case "3":
          if (view !== "deadlines") onViewChange?.("deadlines");
          event.preventDefault();
          event.stopPropagation();
          break;
        default:
          if (event.key.length === 1 && event.key !== "r" && event.key !== "R") {
            event.stopPropagation();
          }
          break;
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, onClose, canGoPrev, currentMonth, currentYear, todayDate, view, onViewChange, closeEventEditor, eventEditor, deadlineEditor, selectedItemId, selectedDay, activeView, itemsByDay, setDeadlineEditor]);

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const start = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const end = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
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
  const panelWidth = `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const showEventsLoading = view === "events" && viewData?.isLoading && (computed?.totalEvents || 0) === 0;
  const showDeadlinesLoadingState = view === "deadlines" && !!viewData?.isLoading;
  const showGridSkeleton = showEventsLoading || showDeadlinesLoadingState;

  const selectedDayState = activeSelectedDay != null
    ? (activeView.getDayState?.(itemsByDay[activeSelectedDay]) ?? buildFallbackDayState(itemsByDay[activeSelectedDay]))
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
      onViewChange={onViewChange}
      HeaderExtras={activeView.HeaderExtras}
      viewData={viewData}
      computed={computed}
      suppressOutsideClick={suppressOutsideClick}
      eventEditor={eventEditor}
      selectedDay={activeSelectedDay}
      viewYear={viewYear}
      viewMonth={viewMonth}
      setDeadlineEditor={setDeadlineEditor}
      onClose={onClose}
      activeView={activeView}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayDate={todayDate}
      firstDay={firstDay}
      daysInMonth={daysInMonth}
      trailingEmpty={trailingEmpty}
      itemsByDay={itemsByDay}
      showGridSkeleton={showGridSkeleton}
      buildFallbackDayState={buildFallbackDayState}
      closeEventEditor={closeEventEditor}
      setSelectedDay={setSelectedDay}
      setSelectedItemId={setSelectedItemId}
      showDetail={showDetail}
      showEmptySelection={showEmptySelection}
      effectiveSelectedItemId={effectiveSelectedItemId}
      selectedDayState={selectedDayState}
      selectedItems={selectedItems}
      deadlineEditor={deadlineEditor}
      focusDeadlineTask={focusDeadlineTask}
    />
  );
}
