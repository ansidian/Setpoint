import { createPortal } from "react-dom";
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { ChevronLeft, ChevronRight, X, Receipt, ListChecks, Calendar as CalendarIcon } from "lucide-react";
import { AnimatePresence, motion as Motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import billsView from "./views/billsView.jsx";
import { getCalendarLayoutMetrics } from "./calendarLayout.js";
import deadlinesView from "./views/deadlinesView.jsx";
import eventsView from "./views/eventsView.jsx";
import CalendarEventEditorRail from "./events/CalendarEventEditorRail.jsx";
import useCalendarEventEditor from "./events/useCalendarEventEditor.js";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const GRID_ROWS = 6;

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

function CalendarCell({
  day,
  items,
  hasItems,
  isToday,
  isSelected,
  pastTone,
  hasOverdue,
  allComplete,
  loading,
  onClick,
  renderCellContents,
}) {
  // Minimal cells: hairline borders, a strong date badge for "today", purple
  // ring on selection, and subtle status accents instead of heavy
  // bg/border combinations.
  const todayAccent = "var(--ea-accent)";
  let cellBg = "rgba(255,255,255,0.015)";
  let cellBorder = "1px solid rgba(255,255,255,0.04)";
  let cellShadow = "none";
  let dateColor = "rgba(205,214,244,0.7)";
  let dateWeight = 400;
  let accentBar = null;
  let todayWash = null;
  let dateBadgeBg = "transparent";
  let dateBadgeBorder = "1px solid transparent";
  let dateBadgeShadow = "none";

  if (isSelected) {
    cellBg = "rgba(203,166,218,0.06)";
    cellBorder = "1px solid rgba(203,166,218,0.4)";
    cellShadow = "0 0 0 1px rgba(203,166,218,0.18), 0 4px 14px rgba(203,166,218,0.18)";
    dateColor = "#cba6da";
    dateWeight = 600;
  } else if (allComplete) {
    accentBar = "#a6e3a1";
    dateColor = "rgba(166,227,161,0.85)";
  } else if (hasOverdue) {
    accentBar = "#f38ba8";
    dateColor = "rgba(243,139,168,0.9)";
  } else if (hasItems) {
    dateColor = "#cdd6f4";
    dateWeight = 500;
  }

  if (!isSelected && !isToday && pastTone) {
    cellBg = pastTone === "items" ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.006)";
    cellBorder = pastTone === "items"
      ? "1px solid rgba(255,255,255,0.028)"
      : "1px solid rgba(255,255,255,0.022)";
    dateColor = pastTone === "items" ? "rgba(205,214,244,0.48)" : "rgba(205,214,244,0.33)";
    if (!hasItems) {
      dateWeight = 400;
    }
  }

  if (isToday) {
    todayWash = isSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 16%, transparent), color-mix(in srgb, ${todayAccent} 6%, transparent) 56%, transparent)`
      : `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 20%, transparent), color-mix(in srgb, ${todayAccent} 8%, transparent) 58%, transparent)`;
    dateColor = isSelected ? "#ffffff" : todayAccent;
    dateWeight = 700;
    dateBadgeBg = isSelected
      ? `color-mix(in srgb, ${todayAccent} 32%, transparent)`
      : `color-mix(in srgb, ${todayAccent} 18%, transparent)`;
    dateBadgeBorder = isSelected
      ? `1px solid color-mix(in srgb, ${todayAccent} 56%, white 12%)`
      : `1px solid color-mix(in srgb, ${todayAccent} 42%, transparent)`;
    dateBadgeShadow = isSelected
      ? `0 0 0 1px color-mix(in srgb, ${todayAccent} 18%, transparent), 0 6px 18px color-mix(in srgb, ${todayAccent} 24%, transparent)`
      : `0 4px 12px color-mix(in srgb, ${todayAccent} 18%, transparent)`;
  }

  const contentRef = useRef(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;

    const updateHeight = () => {
      setContentHeight(el.clientHeight || 0);
    };

    updateHeight();

    if (typeof window.ResizeObserver !== "function") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new window.ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect?.height;
      setContentHeight(nextHeight || el.clientHeight || 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      onClick={onClick}
      aria-current={isToday ? "date" : undefined}
      data-testid={`calendar-cell-${day}`}
      data-past-tone={pastTone || "none"}
      style={{
        position: "relative",
        minWidth: 0, overflow: "hidden", borderRadius: 8,
        padding: "7px 9px",
        background: cellBg, border: cellBorder, boxShadow: cellShadow,
        cursor: "pointer",
        transition: "box-shadow 150ms, border-color 150ms, background 150ms",
        display: "flex", flexDirection: "column", gap: 3,
      }}
    >
      {todayWash && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: 7,
            background: todayWash,
            pointerEvents: "none",
          }}
        />
      )}
      {accentBar && (
        <span
          style={{
            position: "absolute", left: 0, top: 8, bottom: 8, width: 2,
            background: accentBar, borderRadius: 2, opacity: 0.55,
          }}
        />
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: isToday ? 24 : undefined,
            height: isToday ? 24 : undefined,
            padding: isToday ? "0 8px" : 0,
            borderRadius: 999,
            fontSize: 12.5,
            color: dateColor,
            fontWeight: dateWeight,
            fontVariantNumeric: "tabular-nums",
            background: dateBadgeBg,
            border: dateBadgeBorder,
            boxShadow: dateBadgeShadow,
            transition: "background 150ms, border-color 150ms, box-shadow 150ms",
          }}
        >
          {day}
        </span>
      </div>
      <div
        ref={contentRef}
        style={{
          position: "relative",
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {renderCellContents?.({ items, hasOverdue, contentHeight, isToday, loading, pastTone })}
      </div>
    </div>
  );
}

function CalendarSummary({ view, viewYear, viewMonth, currentYear, currentMonth, todayDate, itemsByDay, computed, data, activeView }) {
  // Default-state side rail content. Renders the view-supplied footer
  // (already shows totals + legend) inside the new card layout, plus a
  // friendly empty-state hint at the top.
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 2.6, textTransform: "uppercase",
            color: "rgba(205,214,244,0.55)",
          }}
        >
          {view === "bills" ? "Bills overview" : view === "events" ? "Events overview" : "Deadlines overview"}
        </div>
        <div className="ea-display" style={{ marginTop: 4, fontSize: 18, color: "#fff", letterSpacing: -0.2 }}>
          {isCurrentMonth ? "This month · " : ""}{monthLabel}
        </div>
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }} />
      {view === "events" && data?.isLoading ? (
        <div
          data-testid="calendar-events-rail-skeleton"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Skeleton className="h-[11px] w-[148px] bg-white/8" />
          <Skeleton className="h-[18px] w-[212px] bg-white/10" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
            <Skeleton className="h-[10px] w-full bg-white/7" />
            <Skeleton className="h-[10px] w-[88%] bg-white/7" />
            <Skeleton className="h-[10px] w-[72%] bg-white/7" />
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "rgba(205,214,244,0.55)", lineHeight: 1.5 }}>
          Click any day to drill in. Items are color-coded by source on the rail.
        </div>
      )}
      <span style={{ flex: 1 }} />
      {/* The view's existing footer renderer becomes the per-month summary
          card now that it lives in the rail instead of below the grid. */}
      {activeView.renderFooter?.({ viewYear, viewMonth, currentYear, currentMonth, todayDate, itemsByDay, computed, data })}
    </div>
  );
}

function formatFullDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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

function CalendarSelectedDayEmptyState({ view, selectedDay, viewYear, viewMonth }) {
  const description = view === "events"
    ? "No events on this day yet. Creating a new event will prefill this date."
    : view === "bills"
      ? "No scheduled bills land on this date."
      : "No deadlines are due on this date.";

  return (
    <div style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
          {formatFullDate(viewYear, viewMonth, selectedDay)}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          No items
        </div>
      </div>
      <div
        style={{
          padding: "14px 14px 16px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12, color: "rgba(205,214,244,0.72)", lineHeight: 1.55 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

const railSwapLayoutTransition = {
  type: "spring",
  stiffness: 340,
  damping: 34,
  mass: 0.9,
  bounce: 0,
};

const railSwapFadeTransition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
};

function AnimatedRailContent({ contentKey, contentKind, children }) {
  const shouldLift = contentKind === "detail" || contentKind === "empty";

  return (
    <Motion.div
      layout
      transition={railSwapLayoutTransition}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <Motion.div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          layout
          initial={{
            opacity: 0,
            y: shouldLift ? 6 : 4,
            scale: shouldLift ? 0.992 : 0.996,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: shouldLift ? -4 : -2,
            scale: 0.996,
          }}
          transition={{
            layout: railSwapLayoutTransition,
            opacity: railSwapFadeTransition,
            y: railSwapFadeTransition,
            scale: railSwapFadeTransition,
          }}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            transformOrigin: "top center",
            willChange: "opacity, transform",
          }}
        >
          {children}
        </Motion.div>
      </AnimatePresence>
    </Motion.div>
  );
}

function parseFocusDate(focusDate) {
  if (!focusDate) return null;
  const d = new Date(`${focusDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
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

function CalendarEventsGridSkeleton({
  firstDay,
  daysInMonth,
  trailingEmpty,
  cellHeight,
  gridGap,
}) {
  const rowWidths = cellHeight >= 96
    ? ["84%", "71%", "58%"]
    : ["86%", "63%"];

  return (
    <div
      data-testid="calendar-events-grid-skeleton"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: `repeat(${GRID_ROWS}, ${cellHeight}px)`,
        gap: gridGap,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: firstDay }, (_, i) => (
        <div key={`sk-empty-${i}`} />
      ))}
      {Array.from({ length: daysInMonth }, (_, i) => (
        <div
          key={`sk-day-${i}`}
          style={{
            padding: "28px 9px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {rowWidths.map((width, rowIndex) => (
              <Skeleton
                key={rowIndex}
                className="h-[10px] rounded-sm bg-white/8"
                style={{ width, opacity: rowIndex === rowWidths.length - 1 ? 0.72 : 1 }}
              />
            ))}
          </div>
        </div>
      ))}
      {Array.from({ length: trailingEmpty }, (_, i) => (
        <div key={`sk-trail-${i}`} />
      ))}
    </div>
  );
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
  const [selectedDay, setSelectedDay] = useState(() => (
    initialFocus ? initialFocus.getDate() : null
  ));
  const [selectedItemId, setSelectedItemId] = useState(() => (
    open && focusItemId ? String(focusItemId) : null
  ));
  const [deadlineEditor, setDeadlineEditor] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);

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

  const navigateMonthRef = useRef(null);
  useEffect(() => {
    navigateMonthRef.current = (dir) => {
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
    };
  });
  const navigateMonth = (dir) => navigateMonthRef.current?.(dir);
  const [pendingFocusDate, setPendingFocusDate] = useState(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null);

  function focusDeadlineTask(task) {
    const focus = parseFocusDate(task?.due_date);
    if (focus) {
      setViewDate({ month: focus.getMonth(), year: focus.getFullYear() });
      setSelectedDay(focus.getDate());
    }
    setSelectedItemId(task?.id != null ? String(task.id) : null);
    setDeadlineEditor(null);
  }

  // Reset state when modal opens. If a focusDate is supplied, jump to that
  // month and auto-select the day cell (e.g. clicking a bill drills straight
  // into its due-day's detail rail).
  const [prevOpen, setPrevOpen] = useState(open);
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

  // On view change: honor pending focus drill-in; otherwise preserve the
  // user's current month/year and day selection verbatim — switching views
  // is not an intent to reset navigation state.
  const [prevView, setPrevView] = useState(view);
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

  // Allow views to opt out of outside-click close (e.g., when a popover is open)
  const suppressOutsideClickRef = useRef(null);
  const suppressOutsideClick = useCallback((test) => {
    suppressOutsideClickRef.current = test;
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (suppressOutsideClickRef.current?.(e.target)) return;
      // Ignore clicks inside floating menus/dialogs rendered in portals outside the panel.
      if (e.target.closest?.('[role="menu"], [role="dialog"]')) return;
      if (panelRef.current && !panelRef.current.contains(e.target)) {
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
    const el = scrollRef.current;
    if (!el || !open) return;
    function onWheel(e) {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) { e.preventDefault(); return; }
      const atTop = scrollTop <= 0 && e.deltaY < 0;
      const atBottom = scrollTop >= maxScroll && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  const computed = useMemo(
    () => activeView.compute({ data: viewData, viewYear, viewMonth }),
    [activeView, viewData, viewYear, viewMonth],
  );

  const itemsByDay = useMemo(() => computed.itemsByDay || {}, [computed.itemsByDay]);

  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const todayDate = now.getDate();
  const totalCells = firstDay + daysInMonth;
  const trailingEmpty = GRID_ROWS * 7 - totalCells;

  const canGoPrev = activeView.canNavigateBack
    ? activeView.canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data: viewData, computed })
    : !isCurrentMonth;

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (isSuspendedHotkeyTarget(e.target)) return;

      if (isEditableTarget(e.target)) {
        if (e.key === "Escape") {
          onClose();
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          onClose();
          e.stopPropagation();
          break;
        case "ArrowLeft":
        case "p":
          if (canGoPrev) {
            navigateMonthRef.current(-1);
          }
          e.preventDefault();
          e.stopPropagation();
          break;
        case "ArrowRight":
        case "n":
          navigateMonthRef.current(1);
          e.preventDefault();
          e.stopPropagation();
          break;
        case "t":
        case "T":
          closeEventEditor();
          setViewDate({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          e.preventDefault();
          e.stopPropagation();
          break;
        case "c":
        case "C":
          if (view === "events" && eventEditor.editable) {
            eventEditor.openCreate();
          } else if (view === "deadlines") {
            setDeadlineEditor({
              mode: "create",
              seedDate: null,
            });
          }
          e.preventDefault();
          e.stopPropagation();
          break;
        case "1":
          // Scoped to the modal — stopPropagation prevents the shell's
          // 1=Dashboard hotkey from firing underneath.
          if (view !== "events") onViewChange?.("events");
          e.preventDefault();
          e.stopPropagation();
          break;
        case "2":
          if (view !== "bills") onViewChange?.("bills");
          e.preventDefault();
          e.stopPropagation();
          break;
        case "3":
          if (view !== "deadlines") onViewChange?.("deadlines");
          e.preventDefault();
          e.stopPropagation();
          break;
        default:
          if (e.key.length === 1 && e.key !== "r" && e.key !== "R") {
            e.stopPropagation();
          }
          break;
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, onClose, currentMonth, currentYear, canGoPrev, view, onViewChange, closeEventEditor, eventEditor, todayDate]);

  useEffect(() => {
    if (!open || view !== "events" || !eventsData?.ensureRange) return;
    const start = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const end = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    eventsData.ensureRange(start, end);
  }, [open, view, viewYear, viewMonth, eventsData]);

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long" });
  const monthYear = String(viewYear);
  const layout = getCalendarLayoutMetrics(viewportWidth);
  const panelWidth = `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const showEventsLoadingState =
    view === "events" &&
    viewData?.isLoading &&
    (computed?.totalEvents || 0) === 0;

  if (!open) return null;

  const selectedDayState = selectedDay != null
    ? (activeView.getDayState?.(itemsByDay[selectedDay]) ?? buildFallbackDayState(itemsByDay[selectedDay]))
    : buildFallbackDayState([]);
  const selectedItems = activeView.getDayState ? selectedDayState : selectedDayState.items;
  const effectiveSelectedItemId = view === "deadlines"
    ? (() => {
        if (selectedDay == null || selectedDayState.totalCount === 0) return null;
        const combinedItems = [...selectedDayState.activeItems, ...selectedDayState.completedItems];
        const hasSelectedItem = combinedItems.some((item) => String(item.id) === String(selectedItemId));
        if (hasSelectedItem) return String(selectedItemId);
        const fallbackId = activeView.getDefaultSelectedItemId?.(selectedDayState);
        return fallbackId ? String(fallbackId) : null;
      })()
    : selectedItemId;
  const hasSelectedDay = selectedDay != null;
  const showDeadlineEditor = view === "deadlines" && !!deadlineEditor;
  const showDetail = view === "deadlines"
    ? showDeadlineEditor || (hasSelectedDay && selectedDayState.totalCount > 0)
    : hasSelectedDay && selectedDayState.totalCount > 0;
  const showEmptySelection = view === "deadlines"
    ? hasSelectedDay && selectedDayState.totalCount === 0 && !showDeadlineEditor
    : hasSelectedDay && selectedDayState.totalCount === 0;

  const HeaderExtras = activeView.HeaderExtras;

  return createPortal(
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 49,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.5)",
        }}
      >
        <div
          ref={panelRef}
          data-testid="calendar-modal-panel"
          className="isolate flex flex-col animate-in fade-in zoom-in-95 duration-200"
          style={{
            width: panelWidth,
            maxWidth: `${layout.shellMaxWidth}px`,
            maxHeight: layout.shellMaxHeight,
            background: "radial-gradient(ellipse at top left, #1a1a2a, #0d0d15 70%)",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            ref={scrollRef}
            className="overflow-y-auto overscroll-contain flex-1"
            style={{ padding: layout.shellPadding }}
          >
            {/* Header — eyebrow + display title pattern from the mock */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginBottom: 22, gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 18,
                  justifySelf: "start",
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => canGoPrev && navigateMonth(-1)}
                    aria-label="Previous month"
                    onMouseEnter={(event) => {
                      if (!canGoPrev) return;
                      event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                      event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                      event.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                      event.currentTarget.style.transform = "translateY(0)";
                    }}
                    style={{
                      color: canGoPrev ? "rgba(205,214,244,0.7)" : "rgba(205,214,244,0.18)",
                      cursor: canGoPrev ? "pointer" : "default",
                      width: 36, height: 36,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      fontFamily: "inherit",
                      transform: "translateY(0)",
                      transition: "transform 140ms, background 140ms, border-color 140ms",
                      flexShrink: 0,
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => navigateMonth(1)}
                    aria-label="Next month"
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                      event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                      event.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                      event.currentTarget.style.transform = "translateY(0)";
                    }}
                    style={{
                      color: "rgba(205,214,244,0.7)",
                      cursor: "pointer",
                      width: 36, height: 36,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      fontFamily: "inherit",
                      transform: "translateY(0)",
                      transition: "transform 140ms, background 140ms, border-color 140ms",
                      flexShrink: 0,
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: 2.6, textTransform: "uppercase",
                      color: "rgba(205,214,244,0.55)",
                    }}
                  >
                    Calendar · {VIEWS[view]?.label || "Bills"}
                  </div>
                  <div
                    className="ea-display"
                    style={{
                      fontSize: 28, fontWeight: 500, color: "#fff",
                      letterSpacing: -0.4, lineHeight: 1.05,
                      whiteSpace: layout.headerWrap ? "normal" : "nowrap",
                    }}
                  >
                    {monthName}{" "}
                    <span style={{ color: "rgba(205,214,244,0.4)", fontWeight: 400 }}>{monthYear}</span>
                  </div>
                </div>
              </div>

              {/* Segmented view switcher */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 8,
                  padding: 2,
                  gap: 2,
                  justifySelf: "center",
                }}
              >
                {[
                  { key: "events", label: "Events", Icon: CalendarIcon, hint: "1" },
                  { key: "bills", label: "Bills", Icon: Receipt, hint: "2" },
                  { key: "deadlines", label: "Deadlines", Icon: ListChecks, hint: "3" },
                ].map((opt) => {
                  const active = view === opt.key;
                  const { Icon } = opt;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => !active && onViewChange?.(opt.key)}
                      onMouseEnter={(event) => {
                        if (active) return;
                        event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                        event.currentTarget.style.color = "rgba(205,214,244,0.82)";
                        event.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(event) => {
                        if (active) return;
                        event.currentTarget.style.background = "transparent";
                        event.currentTarget.style.color = "rgba(205,214,244,0.55)";
                        event.currentTarget.style.transform = "translateY(0)";
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: 0.3,
                        border: "none",
                        cursor: active ? "default" : "pointer",
                        fontFamily: "inherit",
                        background: active ? "rgba(203,166,218,0.12)" : "transparent",
                        color: active ? "#cba6da" : "rgba(205,214,244,0.55)",
                        transform: "translateY(0)",
                        transition: "transform 140ms, background 150ms, color 150ms",
                      }}
                    >
                      <Icon size={11} strokeWidth={1.8} />
                      {opt.label}
                      <kbd
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          minWidth: 16, height: 16, padding: "0 4px",
                          fontSize: 9.5, fontFamily: "Fira Code, ui-monospace, monospace", fontWeight: 500,
                          color: active ? "#cba6da" : "rgba(205,214,244,0.45)",
                          background: active ? "rgba(203,166,218,0.10)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${active ? "rgba(203,166,218,0.28)" : "rgba(255,255,255,0.06)"}`,
                          borderRadius: 4, letterSpacing: 0,
                          marginLeft: 2,
                        }}
                      >
                        {opt.hint}
                      </kbd>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "end" }}>
                {HeaderExtras ? (
                  <HeaderExtras
                    data={viewData}
                    computed={computed}
                    suppressOutsideClick={suppressOutsideClick}
                    editor={eventEditor}
                    selectedDay={selectedDay}
                    viewYear={viewYear}
                    viewMonth={viewMonth}
                    onCreateTask={(seedDate) => {
                      setDeadlineEditor({
                        mode: "create",
                        seedDate: seedDate || null,
                      });
                    }}
                  />
                ) : null}
                <button
                  onClick={onClose}
                  aria-label="Close"
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                    event.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    event.currentTarget.style.transform = "translateY(0)";
                  }}
                  style={{
                    color: "rgba(205,214,244,0.7)",
                    cursor: "pointer",
                    width: 36, height: 36,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontFamily: "inherit",
                    transform: "translateY(0)",
                    transition: "transform 140ms, background 140ms, border-color 140ms",
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body: calendar (left) + side rail (right) */}
            <div
              data-testid="calendar-modal-body"
              style={{
                display: "grid",
                gridTemplateColumns: layout.stacked ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${layout.railWidth}px`,
                gap: layout.contentGap,
                alignItems: "start",
              }}
            >
              <div style={{ minWidth: 0, position: "relative" }}>
                {/* Day-of-week headers */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: layout.weekHeaderGap, marginBottom: 8 }}>
                  {DAYS.map((d) => (
                    <div
                      key={d}
                      style={{
                        textAlign: "center", fontSize: 10, fontWeight: 600,
                        color: "rgba(205,214,244,0.4)",
                        padding: 4, letterSpacing: 1.6, textTransform: "uppercase",
                      }}
                    >
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div style={{ position: "relative" }}>
                  <div
                    key={`${view}-${viewYear}-${viewMonth}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gridTemplateRows: `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
                      gap: layout.gridGap,
                    }}
                  >
                    {Array.from({ length: firstDay }, (_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const rawItems = Array.isArray(itemsByDay[day]) ? itemsByDay[day] : [];
                      const dayState = activeView.getDayState?.(itemsByDay[day]) ?? buildFallbackDayState(itemsByDay[day]);
                      const cellItems = activeView.getDayState ? dayState : rawItems;
                      const hasItems = dayState.totalCount > 0;
                      const isToday = isCurrentMonth && day === todayDate;
                      const isSelected = selectedDay === day;
                      const hasOverdue = activeView.hasOverdue?.(dayState) || false;
                      const allComplete = activeView.allComplete?.(dayState) || false;
                      const isPastDay = view === "events"
                        && new Date(viewYear, viewMonth, day) < new Date(currentYear, currentMonth, todayDate);
                      const pastTone = isPastDay ? (hasItems ? "items" : "empty") : null;

                      return (
                        <CalendarCell
                          key={day}
                          day={day}
                          items={cellItems}
                          hasItems={hasItems}
                          isToday={isToday}
                          isSelected={isSelected}
                          pastTone={pastTone}
                          hasOverdue={hasOverdue}
                          allComplete={allComplete}
                          loading={viewData?.isLoading}
                          onClick={() => {
                            closeEventEditor();
                            if (isSelected) {
                              setSelectedDay(null);
                              setSelectedItemId(null);
                              setDeadlineEditor(null);
                              return;
                            }
                            setSelectedDay(day);
                            if (view === "deadlines") {
                              setDeadlineEditor(null);
                              const nextId = activeView.getDefaultSelectedItemId?.(dayState);
                              setSelectedItemId(nextId ? String(nextId) : null);
                            }
                          }}
                          renderCellContents={activeView.renderCellContents}
                        />
                      );
                    })}

                    {Array.from({ length: trailingEmpty }, (_, i) => (
                      <div key={`trail-${i}`} />
                    ))}
                  </div>
                  {showEventsLoadingState && (
                    <CalendarEventsGridSkeleton
                      firstDay={firstDay}
                      daysInMonth={daysInMonth}
                      trailingEmpty={trailingEmpty}
                      cellHeight={layout.cellHeight}
                      gridGap={layout.gridGap}
                    />
                  )}
                </div>
              </div>

              {/* Side rail — detail when a day is selected, summary otherwise */}
              <aside
                data-testid="calendar-modal-rail"
                style={{
                  position: layout.stickyRail ? "sticky" : "relative",
                  top: 0,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 12,
                  minHeight: GRID_ROWS * layout.cellHeight + (GRID_ROWS - 1) * layout.gridGap + 30,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <AnimatedRailContent
                  contentKind={
                    view === "events" && eventEditor.isEditorOpen
                      ? "editor"
                      : view === "deadlines" && deadlineEditor?.mode
                        ? "editor"
                        : showDetail
                          ? "detail"
                          : showEmptySelection
                            ? "empty"
                            : "summary"
                  }
                  contentKey={
                    view === "events" && eventEditor.isEditorOpen
                      ? `editor-${eventEditor.isEditing ? eventEditor.editingEvent?.id || "edit" : "new"}`
                      : view === "deadlines" && deadlineEditor?.mode
                        ? `deadline-editor-${deadlineEditor.mode}-${deadlineEditor.taskId || deadlineEditor.seedDate || "new"}`
                      : showDetail
                        ? `detail-${view}-${viewYear}-${viewMonth}-${selectedDay}-${effectiveSelectedItemId || "none"}-${selectedDayState.totalCount}`
                        : showEmptySelection
                          ? `empty-${view}-${viewYear}-${viewMonth}-${selectedDay}`
                          : `summary-${view}-${viewYear}-${viewMonth}`
                  }
                >
                  {view === "events" && eventEditor.isEditorOpen ? (
                    <CalendarEventEditorRail editor={eventEditor} />
                  ) : activeView.renderSidebar ? (
                    activeView.renderSidebar({ selectedDay, itemsByDay, viewYear, viewMonth, data: viewData })
                  ) : showDetail ? (
                    activeView.renderDetail?.({
                      selectedDay,
                      viewYear,
                      viewMonth,
                      items: selectedItems,
                      data: viewData,
                      computed,
                      onSelectEvent: eventEditor.openEdit,
                      selectedItemId: effectiveSelectedItemId,
                      onSelectItem: (itemId) => {
                        setSelectedItemId(String(itemId));
                        setDeadlineEditor(null);
                      },
                      editorState: deadlineEditor,
                      onStartEdit: (task) => {
                        setSelectedItemId(String(task.id));
                        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
                      },
                      onCloseEditor: () => setDeadlineEditor(null),
                      onTaskSaved: focusDeadlineTask,
                      onTaskDeleted: (taskId) => {
                        setDeadlineEditor(null);
                        if (String(effectiveSelectedItemId) === String(taskId)) {
                          setSelectedItemId(null);
                        }
                      },
                    })
                  ) : showEmptySelection ? (
                    <CalendarSelectedDayEmptyState
                      view={view}
                      selectedDay={selectedDay}
                      viewYear={viewYear}
                      viewMonth={viewMonth}
                    />
                  ) : (
                    <CalendarSummary
                      view={view}
                      viewYear={viewYear}
                      viewMonth={viewMonth}
                      currentYear={currentYear}
                      currentMonth={currentMonth}
                      todayDate={todayDate}
                      itemsByDay={itemsByDay}
                      computed={computed}
                      data={viewData}
                      activeView={activeView}
                    />
                  )}
                </AnimatedRailContent>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
