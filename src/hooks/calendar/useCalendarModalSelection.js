import { useCallback, useMemo, useState } from "react";
import { ymdFromParts } from "../../components/calendar/calendarDateUtils.js";
import {
  buildCalendarModalSyncSnapshot,
  parseFocusDate,
  resolveFocusViewDate,
} from "./calendarModalSelectionModel.js";

export default function useCalendarModalSelection({
  open,
  view,
  focusDate,
  focusItemId,
  openRequestId,
}) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const todayDate = now.getDate();
  const initialFocus = open ? parseFocusDate(focusDate) : null;
  const shouldSeedToday = open;
  const currentViewDate = { month: currentMonth, year: currentYear };
  const todayDateKey = ymdFromParts(currentYear, currentMonth, todayDate);

  const [viewDate, setViewDate] = useState(() => (
    initialFocus
      ? resolveFocusViewDate(initialFocus, currentViewDate)
      : currentViewDate
  ));
  const [fetchAnchor, setFetchAnchor] = useState(() => (
    initialFocus
      ? resolveFocusViewDate(initialFocus, currentViewDate)
      : currentViewDate
  ));
  const [selectedDay, setSelectedDay] = useState(() => (
    initialFocus ? initialFocus.getDate() : shouldSeedToday ? todayDate : null
  ));
  const [selectedDateKey, setSelectedDateKey] = useState(() => (
    initialFocus
      ? ymdFromParts(initialFocus.getFullYear(), initialFocus.getMonth(), initialFocus.getDate())
      : shouldSeedToday
        ? todayDateKey
        : null
  ));
  const [selectedItemId, setSelectedItemId] = useState(() => (
    open && focusItemId ? String(focusItemId) : null
  ));
  const [pendingFocusDate, setPendingFocusDate] = useState(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevView, setPrevView] = useState(view);
  const [prevOpenRequestId, setPrevOpenRequestId] = useState(openRequestId);

  const syncSnapshot = useMemo(() => buildCalendarModalSyncSnapshot({
    open,
    view,
    prevOpen,
    prevView,
    prevOpenRequestId,
    openRequestId,
    focusDate,
    focusItemId,
    viewDate,
    selectedDay,
    selectedDateKey,
    selectedItemId,
    pendingFocusDate,
    pendingFocusItemId,
  }), [open, view, prevOpen, prevView, prevOpenRequestId, openRequestId, focusDate, focusItemId, viewDate, selectedDay, selectedDateKey, selectedItemId, pendingFocusDate, pendingFocusItemId]);

  const activeViewDate = syncSnapshot?.nextViewDate || viewDate;
  const activeSelectedDay = syncSnapshot ? syncSnapshot.nextSelectedDay : selectedDay;
  const activeSelectedDateKey = syncSnapshot ? syncSnapshot.nextSelectedDateKey : selectedDateKey;
  const activeSelectedItemId = syncSnapshot ? syncSnapshot.nextSelectedItemId : selectedItemId;

  const commitSyncSnapshot = useCallback((snapshot, runtime = {}) => {
    if (snapshot) {
      setViewDate((current) => (
        current.month === snapshot.nextViewDate.month && current.year === snapshot.nextViewDate.year
          ? current
          : snapshot.nextViewDate
      ));
      setFetchAnchor((current) => (
        current.month === snapshot.nextViewDate.month && current.year === snapshot.nextViewDate.year
          ? current
          : snapshot.nextViewDate
      ));
      setSelectedDay((current) => (
        current === snapshot.nextSelectedDay ? current : snapshot.nextSelectedDay
      ));
      setSelectedDateKey((current) => (
        current === snapshot.nextSelectedDateKey ? current : snapshot.nextSelectedDateKey
      ));
      setSelectedItemId((current) => (
        current === snapshot.nextSelectedItemId ? current : snapshot.nextSelectedItemId
      ));
      setPendingFocusDate((current) => (
        current === snapshot.nextPendingFocusDate ? current : snapshot.nextPendingFocusDate
      ));
      setPendingFocusItemId((current) => (
        current === snapshot.nextPendingFocusItemId ? current : snapshot.nextPendingFocusItemId
      ));
    }
    const nextOpen = runtime.open ?? open;
    const nextView = runtime.view ?? view;
    const nextOpenRequestId = runtime.openRequestId ?? openRequestId;
    setPrevOpen((current) => (current === nextOpen ? current : nextOpen));
    setPrevView((current) => (current === nextView ? current : nextView));
    setPrevOpenRequestId((current) => (
      current === nextOpenRequestId ? current : nextOpenRequestId
    ));
  }, [open, view, openRequestId]);

  const focusDateKey = useCallback((ymd) => {
    const focus = parseFocusDate(ymd);
    if (!focus) return null;
    const dateKey = ymdFromParts(focus.getFullYear(), focus.getMonth(), focus.getDate());
    setViewDate((current) => resolveFocusViewDate(focus, current));
    setFetchAnchor((current) => resolveFocusViewDate(focus, current));
    setSelectedDay(focus.getDate());
    setSelectedDateKey(dateKey);
    return { dateKey, day: focus.getDate() };
  }, []);

  return {
    currentMonth,
    currentYear,
    todayDate,
    viewDate,
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
    commitSyncSnapshot,
    focusDateKey,
  };
}
