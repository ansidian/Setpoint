import { useCallback, useMemo, useRef } from "react";
import { pacificTodayParts } from "../../components/calendar/calendarDateUtils.ts";
import {
  agendaCrossesGridBoundary,
  agendaTargetForGridMonth,
  gridVisibleDateRange,
} from "./calendarScrollSyncModel";

export interface CalendarMonthTarget {
  year: number;
  month: number;
}

export type AgendaScrollCommand =
  | { type: "date"; dateKey: string }
  | { type: "today" };

export interface CalendarScrollSyncOptions {
  requestAgendaScroll: (command: AgendaScrollCommand) => void;
  viewDate: CalendarMonthTarget;
  firstDay: number;
  setViewDate: (target: CalendarMonthTarget) => void;
  setFetchAnchor: (target: CalendarMonthTarget) => void;
  setLabelMonth: (target: CalendarMonthTarget) => void;
  isDirtyCheck: () => boolean;
  isEditorOpenCheck?: () => boolean;
  shakeEditor: () => void;
}

const SUPPRESSION_MS = 900;
// Minimum spacing between crossing-driven rail commands. Low enough that the
// rail visibly tracks deliberate scrolling, high enough that a fast fling
// does not turn back into a per-month command stream (the serialized-walk
// problem the settle-time sync exists to prevent).
const GRID_CROSSING_SYNC_MIN_MS = 600;

// All agenda scrolls go through requestAgendaScroll (the declarative
// scroll-command pipeline) rather than a one-shot imperative ref call: the
// command is retried as agenda months mount, so targets in not-yet-fetched
// months still land once the data arrives.
export default function useCalendarScrollSync({
  requestAgendaScroll,
  viewDate,
  firstDay,
  setViewDate,
  setFetchAnchor,
  setLabelMonth,
  isDirtyCheck,
  isEditorOpenCheck,
  shakeEditor,
}: CalendarScrollSyncOptions) {
  const agendaSuppressedUntilRef = useRef(0);
  const gridSuppressedUntilRef = useRef(0);

  const visibleRange = useMemo(
    () => gridVisibleDateRange(viewDate, { firstDay }),
    [viewDate, firstDay],
  );

  const suppressBoth = useCallback(() => {
    const until = performance.now() + SUPPRESSION_MS;
    gridSuppressedUntilRef.current = until;
    agendaSuppressedUntilRef.current = until;
  }, []);

  const onAgendaScroll = useCallback((topmostDate: string) => {
    if (performance.now() < gridSuppressedUntilRef.current) {
      return;
    }
    if (isEditorOpenCheck?.()) {
      return;
    }
    const boundary = agendaCrossesGridBoundary(topmostDate, visibleRange);
    if (!boundary.crossed) {
      return;
    }
    agendaSuppressedUntilRef.current = performance.now() + SUPPRESSION_MS;
    setViewDate(boundary.targetMonth);
    setLabelMonth(boundary.targetMonth);
  }, [visibleRange, setViewDate, setLabelMonth, isEditorOpenCheck]);

  // Grid → agenda sync has a throttled leading edge (crossings, so the rail
  // visibly follows while the user scrolls) and an unthrottled trailing
  // authority (settle, so the rail always ends on the final month). Issuing
  // every crossing unthrottled would keep each rail target within fetch
  // reach of the loaded edge and make the fetch planner walk the whole
  // scrolled gap in serialized batches — one full rail rebuild per settle.
  const lastGridSyncRef = useRef<{ at: number; dateKey: string | null }>({ at: -Infinity, dateKey: null });

  const issueGridSync = useCallback((year: number, month: number) => {
    const now = performance.now();
    const dateKey = agendaTargetForGridMonth(year, month);
    const last = lastGridSyncRef.current;
    if (last.dateKey === dateKey && now - last.at < SUPPRESSION_MS) return;
    lastGridSyncRef.current = { at: now, dateKey };
    gridSuppressedUntilRef.current = now + SUPPRESSION_MS;
    requestAgendaScroll({ type: "date", dateKey });
  }, [requestAgendaScroll]);

  const onGridScrollCrossing = useCallback(({ year, month }: CalendarMonthTarget) => {
    const now = performance.now();
    if (now < agendaSuppressedUntilRef.current) return;
    if (now - lastGridSyncRef.current.at < GRID_CROSSING_SYNC_MIN_MS) return;
    issueGridSync(year, month);
  }, [issueGridSync]);

  const onGridScrollSettle = useCallback(({ year, month }: CalendarMonthTarget) => {
    if (performance.now() < agendaSuppressedUntilRef.current) {
      return;
    }
    issueGridSync(year, month);
  }, [issueGridSync]);

  const syncAgendaToMonth = useCallback((year: number, month: number) => {
    suppressBoth();
    requestAgendaScroll({ type: "date", dateKey: agendaTargetForGridMonth(year, month) });
  }, [requestAgendaScroll, suppressBoth]);

  const navigateToDate = useCallback((dateKey: string) => {
    if (isDirtyCheck()) { shakeEditor(); return false; }
    suppressBoth();
    requestAgendaScroll({ type: "date", dateKey });
    const year = Number(dateKey.slice(0, 4));
    const month = Number(dateKey.slice(5, 7)) - 1;
    if (year !== viewDate.year || month !== viewDate.month) {
      setViewDate({ year, month });
      setFetchAnchor({ year, month });
      setLabelMonth({ year, month });
    }
    return true;
  }, [requestAgendaScroll, suppressBoth, isDirtyCheck, shakeEditor, viewDate, setViewDate, setFetchAnchor, setLabelMonth]);

  const navigateToMonth = useCallback((year: number, month: number) => {
    if (isDirtyCheck()) { shakeEditor(); return false; }
    syncAgendaToMonth(year, month);
    setViewDate({ year, month });
    setFetchAnchor({ year, month });
    setLabelMonth({ year, month });
    return true;
  }, [syncAgendaToMonth, isDirtyCheck, shakeEditor, setViewDate, setFetchAnchor, setLabelMonth]);

  const navigateToToday = useCallback(() => {
    if (isDirtyCheck()) { shakeEditor(); return false; }
    suppressBoth();
    requestAgendaScroll({ type: "today" });
    const todayParts = pacificTodayParts()!;
    const year = todayParts.year;
    const month = todayParts.month;
    if (year !== viewDate.year || month !== viewDate.month) {
      setViewDate({ year, month });
      setFetchAnchor({ year, month });
      setLabelMonth({ year, month });
    }
    return true;
  }, [requestAgendaScroll, suppressBoth, isDirtyCheck, shakeEditor, viewDate, setViewDate, setFetchAnchor, setLabelMonth]);

  const isAgendaDriven = useCallback(() => (
    performance.now() < agendaSuppressedUntilRef.current
  ), []);

  return { onAgendaScroll, onGridScrollCrossing, onGridScrollSettle, syncAgendaToMonth, navigateToDate, navigateToMonth, navigateToToday, isAgendaDriven };
}

export type CalendarScrollSyncController = ReturnType<typeof useCalendarScrollSync>;
