import { useEffect, useMemo, useRef, useState } from "react";
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
  const [deadlineEditor, setDeadlineEditor] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pendingFocusDate, setPendingFocusDate] = useState(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const navigateMonthRef = useRef(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevView, setPrevView] = useState(view);

  const viewMonth = viewDate.month;
  const viewYear = viewDate.year;
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
    selectedDay,
    viewYear,
    viewMonth,
    refreshRange: eventsData?.refreshRange,
    onFocusDate: focusEditorDate,
  });
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

  const openingWithFocus = prevOpen !== open && open
    ? parseFocusDate(focusDate)
    : null;
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const focus = parseFocusDate(focusDate);
      setPendingFocusDate(focusDate || null);
      setPendingFocusItemId(focusItemId ? String(focusItemId) : null);
      setDeadlineEditor(null);
      if (focus) {
        setViewDate({ month: focus.getMonth(), year: focus.getFullYear() });
        setSelectedDay(focus.getDate());
        setSelectedItemId(focusItemId ? String(focusItemId) : null);
      } else {
        setViewDate({ month: currentMonth, year: currentYear });
        setSelectedDay(now.getDate());
        setSelectedItemId(null);
      }
    }
  }

  if (prevView !== view) {
    setPrevView(view);
    closeEventEditor();
    setDeadlineEditor(null);
    const pendingFocus = openingWithFocus || parseFocusDate(pendingFocusDate);
    if (pendingFocus) {
      setViewDate({ month: pendingFocus.getMonth(), year: pendingFocus.getFullYear() });
      setSelectedDay(pendingFocus.getDate());
      setSelectedItemId(pendingFocusItemId ? String(pendingFocusItemId) : null);
      setPendingFocusDate(null);
      setPendingFocusItemId(null);
    }
  }

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
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
  }, [open, onClose, canGoPrev, currentMonth, currentYear, todayDate, view, onViewChange, closeEventEditor, eventEditor]);

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const start = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const end = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    eventsData.ensureRange(start, end);
  }, [open, view, viewYear, viewMonth, eventsData]);

  if (!open) return null;

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" });
  const monthYear = String(viewYear);
  const layout = getCalendarLayoutMetrics(viewportWidth);
  const panelWidth = `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const showEventsLoadingState = view === "events" && viewData?.isLoading && (computed?.totalEvents || 0) === 0;

  const selectedDayState = selectedDay != null
    ? (activeView.getDayState?.(itemsByDay[selectedDay]) ?? buildFallbackDayState(itemsByDay[selectedDay]))
    : buildFallbackDayState([]);
  const selectedItems = activeView.getDayState ? selectedDayState : selectedDayState.items;
  const effectiveSelectedItemId = (() => {
    if (selectedDay == null || selectedDayState.totalCount === 0) return null;
    if (!activeView.getDefaultSelectedItemId) return selectedItemId;

    const pool = view === "deadlines"
      ? [...selectedDayState.activeItems, ...selectedDayState.completedItems]
      : Array.isArray(selectedItems)
        ? selectedItems
        : selectedDayState.items || [];
    const resolveItemId = activeView.getItemId || ((item) => item?.id);
    const hasSelectedItem = pool.some((item) => String(resolveItemId(item)) === String(selectedItemId));
    if (hasSelectedItem) return String(selectedItemId);
    const fallbackId = activeView.getDefaultSelectedItemId(selectedDayState);
    return fallbackId ? String(fallbackId) : null;
  })();
  const hasSelectedDay = selectedDay != null;
  const showDeadlineEditor = view === "deadlines" && !!deadlineEditor;
  const showDetail = view === "deadlines"
    ? showDeadlineEditor || (hasSelectedDay && selectedDayState.totalCount > 0)
    : hasSelectedDay && selectedDayState.totalCount > 0;
  const showEmptySelection = view === "deadlines"
    ? hasSelectedDay && selectedDayState.totalCount === 0 && !showDeadlineEditor
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
      selectedDay={selectedDay}
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
      showEventsLoadingState={showEventsLoadingState}
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
