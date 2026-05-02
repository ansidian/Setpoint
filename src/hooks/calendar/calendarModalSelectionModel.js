import { ymdFromParts } from "../../components/calendar/calendarDateUtils.js";

export function parseFocusDate(focusDate) {
  if (!focusDate) return null;
  const date = new Date(`${focusDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function ymdFromView({ viewYear, viewMonth, selectedDay }) {
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

export function isSameViewDate(a, b) {
  return a?.month === b?.month && a?.year === b?.year;
}

export function buildCalendarModalSyncSnapshot({
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
}) {
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
}
