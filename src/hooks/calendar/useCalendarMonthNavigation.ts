import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  type CalendarMonthPosition,
  type CalendarScrollDirection,
  clampCalendarMonthTarget,
  dateToMonthIndex,
  deriveScrollDirection,
} from "./calendarScrollModel";
import { SCROLL_IDLE_THRESHOLD_MS } from "./calendarControllerHelpers";

interface FloatingEditorState { open?: boolean; mode?: string }
interface EventEditorState { isEditorOpen?: boolean }
interface CalendarNavigationSync {
  syncAgendaToMonth: (year: number, month: number) => void;
  onGridScrollCrossing: (target: CalendarMonthPosition) => void;
  onGridScrollSettle: (target: CalendarMonthPosition) => void;
  isAgendaDriven: () => boolean;
}

export interface CalendarMonthNavigationOptions {
  currentYear: number;
  currentMonth: number;
  viewYear: number;
  viewMonth: number;
  fetchAnchor: CalendarMonthPosition;
  setViewDate: Dispatch<SetStateAction<CalendarMonthPosition>>;
  setFetchAnchor: Dispatch<SetStateAction<CalendarMonthPosition>>;
  setLabelMonth: Dispatch<SetStateAction<CalendarMonthPosition>>;
  setManualMonthBrowseKey: Dispatch<SetStateAction<number>>;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  floatingDetailRef: MutableRefObject<FloatingEditorState | null>;
  eventEditorRef: MutableRefObject<EventEditorState | null>;
  deadlineEditor: { mode?: string } | null;
  closeEventEditor: () => void;
  setDeadlineEditor: (value: null) => void;
  setDeadlineDraftPreview: (value: null) => void;
  sync: CalendarNavigationSync;
}

export default function useCalendarMonthNavigation({
  currentYear,
  currentMonth,
  viewYear,
  viewMonth,
  fetchAnchor,
  setViewDate,
  setFetchAnchor,
  setLabelMonth,
  setManualMonthBrowseKey,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  floatingDetailRef,
  eventEditorRef,
  deadlineEditor,
  closeEventEditor,
  setDeadlineEditor,
  setDeadlineDraftPreview,
  sync,
}: CalendarMonthNavigationOptions) {
  const navigateMonthRef = useRef<((direction: number, options?: Record<string, never>) => void) | null>(null);
  const scrollDirectionRef = useRef<CalendarScrollDirection>("idle");
  const scrollDrivenRef = useRef(false);
  const prevMonthIndexRef = useRef<number | null>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchAnchorRef = useRef(fetchAnchor);

  useEffect(() => {
    fetchAnchorRef.current = fetchAnchor;
  }, [fetchAnchor]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current != null) {
      clearTimeout(scrollIdleTimerRef.current);
    }
  }, []);

  const clearIdleSelection = useCallback((currentFloating: FloatingEditorState | null, anyEditorOpen: string | boolean | undefined) => {
    if (anyEditorOpen || currentFloating?.open) return;
    closeEventEditor();
    setSelectedDay(null);
    setSelectedDateKey(null);
    setSelectedItemId(null);
    setDeadlineEditor(null);
  }, [
    closeEventEditor,
    setDeadlineEditor,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
  ]);

  const commitMonthTarget = useCallback((target: CalendarMonthPosition) => {
    setViewDate(target);
    setFetchAnchor(target);
    setLabelMonth(target);
    sync.syncAgendaToMonth(target.year, target.month);
  }, [setFetchAnchor, setLabelMonth, setViewDate, sync]);

  const editorState = useCallback(() => {
    const currentFloating = floatingDetailRef.current;
    const anyEditorOpen = (
      currentFloating?.open
      && (currentFloating.mode === "edit" || currentFloating.mode === "create")
    ) || eventEditorRef.current?.isEditorOpen || deadlineEditor?.mode;
    return { currentFloating, anyEditorOpen };
  }, [deadlineEditor?.mode, eventEditorRef, floatingDetailRef]);

  const navigateMonth = useCallback((dir: number, _options: Record<string, never> = {}) => {
    const { currentFloating, anyEditorOpen } = editorState();
    if (!anyEditorOpen) setDeadlineDraftPreview(null);
    clearIdleSelection(currentFloating, anyEditorOpen);
    setManualMonthBrowseKey((key) => key + 1);
    commitMonthTarget(clampCalendarMonthTarget({
      targetYear: viewYear,
      targetMonth: viewMonth + dir,
      currentYear,
      currentMonth,
    }));
  }, [
    clearIdleSelection,
    commitMonthTarget,
    currentMonth,
    currentYear,
    editorState,
    setDeadlineDraftPreview,
    setManualMonthBrowseKey,
    viewMonth,
    viewYear,
  ]);

  const jumpToMonth = useCallback((year: number, month: number) => {
    const { currentFloating, anyEditorOpen } = editorState();
    setDeadlineDraftPreview(null);
    clearIdleSelection(currentFloating, anyEditorOpen);
    commitMonthTarget(clampCalendarMonthTarget({
      targetYear: year,
      targetMonth: month,
      currentYear,
      currentMonth,
    }));
  }, [
    clearIdleSelection,
    commitMonthTarget,
    currentMonth,
    currentYear,
    editorState,
    setDeadlineDraftPreview,
  ]);

  useEffect(() => {
    navigateMonthRef.current = navigateMonth;
  }, [navigateMonth]);

  const onDisplayMonthChange = useCallback(({ year, month }: CalendarMonthPosition) => {
    const currentIndex = dateToMonthIndex(year, month, currentYear, currentMonth);
    scrollDirectionRef.current = deriveScrollDirection(
      prevMonthIndexRef.current,
      currentIndex,
    );
    prevMonthIndexRef.current = currentIndex;
    if (scrollIdleTimerRef.current != null) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollDirectionRef.current = "idle";
      scrollIdleTimerRef.current = null;
    }, SCROLL_IDLE_THRESHOLD_MS);
    if (sync.isAgendaDriven()) return;
    const floatingDetail = floatingDetailRef.current;
    if (floatingDetail?.open && (
      floatingDetail.mode === "edit" || floatingDetail.mode === "create"
    )) return;
    setViewDate({ year, month });
    sync.onGridScrollCrossing({ year, month });
  }, [currentMonth, currentYear, floatingDetailRef, setViewDate, sync]);

  const onLabelMonthChange = useCallback(({ year, month }: CalendarMonthPosition) => {
    if (sync.isAgendaDriven()) return;
    setLabelMonth((current) => (
      current.year === year && current.month === month ? current : { year, month }
    ));
  }, [setLabelMonth, sync]);

  const onFetchSettle = useCallback(({ year, month, scrollDriven = true }: CalendarMonthPosition & { scrollDriven?: boolean }) => {
    const anchor = fetchAnchorRef.current;
    if (anchor.year !== year || anchor.month !== month) {
      scrollDrivenRef.current = scrollDriven;
    }
    setFetchAnchor({ year, month });
    if (sync.isAgendaDriven() || !scrollDriven) return;
    const floatingDetail = floatingDetailRef.current;
    if (floatingDetail?.open && (
      floatingDetail.mode === "edit" || floatingDetail.mode === "create"
    )) return;
    sync.onGridScrollSettle({ year, month });
  }, [floatingDetailRef, setFetchAnchor, sync]);

  return {
    navigateMonthRef,
    scrollDirectionRef,
    scrollDrivenRef,
    navigateMonth,
    jumpToMonth,
    onDisplayMonthChange,
    onLabelMonthChange,
    onFetchSettle,
  };
}

export type CalendarMonthNavigationController = ReturnType<typeof useCalendarMonthNavigation>;
