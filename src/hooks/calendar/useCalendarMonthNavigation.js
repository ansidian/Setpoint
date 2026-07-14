import { useCallback, useEffect, useRef } from "react";
import {
  clampCalendarMonthTarget,
  dateToMonthIndex,
  deriveScrollDirection,
} from "./calendarScrollModel.js";
import { SCROLL_IDLE_THRESHOLD_MS } from "./calendarControllerHelpers.js";

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
}) {
  const navigateMonthRef = useRef(null);
  const scrollDirectionRef = useRef("idle");
  const scrollDrivenRef = useRef(false);
  const prevMonthIndexRef = useRef(null);
  const scrollIdleTimerRef = useRef(null);
  const fetchAnchorRef = useRef(fetchAnchor);

  useEffect(() => {
    fetchAnchorRef.current = fetchAnchor;
  }, [fetchAnchor]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current != null) {
      clearTimeout(scrollIdleTimerRef.current);
    }
  }, []);

  const clearIdleSelection = useCallback((currentFloating, anyEditorOpen) => {
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

  const commitMonthTarget = useCallback((target) => {
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

  const navigateMonth = useCallback((dir, _options = {}) => {
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

  const jumpToMonth = useCallback((year, month) => {
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

  const onDisplayMonthChange = useCallback(({ year, month }) => {
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

  const onLabelMonthChange = useCallback(({ year, month }) => {
    if (sync.isAgendaDriven()) return;
    setLabelMonth((current) => (
      current.year === year && current.month === month ? current : { year, month }
    ));
  }, [setLabelMonth, sync]);

  const onFetchSettle = useCallback(({ year, month, scrollDriven = true }) => {
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
