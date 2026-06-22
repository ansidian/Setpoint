import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveCalendarOpenState,
  shouldClearCalendarFocusOnLeave,
} from "./dashboardShellModel.js";
import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel.js";

// Owns the dashboard shell's calendar-workspace state slice: which view is
// showing, the one-shot focus/overlay deep-link state, the open-request counter,
// and the events range reported back to the parent. `openCalendar` is the single
// entry point for every deep-link (dashboard rows, command palette, hotkeys,
// Alfred chips); it resolves the next state via the pure dashboardShellModel and
// switches to the calendar tab. The leave effect drops the one-shot focus/overlays
// once the user leaves the calendar tab so a later manual return can't resurrect
// them.
//
// `calendarMounted` deliberately stays in the shell (it gates rendering the
// calendar tab and is also flipped on by tab navigation); this hook only turns it
// on via the passed-in `setCalendarMounted` when a deep-link opens the calendar,
// which avoids a circular dependency with the shell's `setShellTab`.
export default function useCalendarWorkspaceState({
  isMobile,
  tab,
  setShellTab,
  setCalendarMounted,
  liveData,
  loadCalendarDeadlines,
  loadCalendarBills,
  onCalendarWorkspaceChange,
}) {
  const [calendarOpenRequestId, setCalendarOpenRequestId] = useState(0);
  const [calendarView, setCalendarView] = useState(() => {
    try {
      const saved = localStorage.getItem("calendar:lastView");
      if (saved === "bills" || saved === "events") return saved;
      return "events";
    } catch { return "events"; }
  });
  const showBills = !!liveData.actualConfigured;
  const [calendarFocus, setCalendarFocus] = useState(null);
  const [calendarFocusItemId, setCalendarFocusItemId] = useState(null);
  const [calendarFocusOpenDetail, setCalendarFocusOpenDetail] = useState(false);
  const [calendarForceOverlays, setCalendarForceOverlays] = useState({ events: false, deadlines: false, completedDeadlines: false });
  const calendarEventsRangeRef = useRef(null);

  // Memoized so the (memoized) AlfredPanel's onOpenCalendarItem can be stable and
  // bail out on unrelated dashboard re-renders. State setters are referentially
  // stable; deps are only the values openCalendar actually reads/calls.
  const openCalendar = useCallback((viewKey, focusDate = null, focusItemId = null, options = {}) => {
    const request = resolveCalendarOpenState({
      isMobile,
      viewKey,
      currentView: calendarView,
      showBills,
      focusDate,
      focusItemId,
      options,
    });
    if (!request) return;
    setCalendarView(request.view);
    try { localStorage.setItem("calendar:lastView", request.view); } catch { /* ignore */ }
    setCalendarFocus(request.focusDate);
    setCalendarFocusItemId(request.focusItemId);
    setCalendarFocusOpenDetail(request.focusOpenDetail);
    setCalendarForceOverlays({ events: request.forceEventOverlay, deadlines: request.forceDeadlineOverlay, completedDeadlines: request.forceCompletedDeadlineOverlay });
    setCalendarOpenRequestId((value) => value + 1);
    setCalendarMounted(true);
    setShellTab("calendar");
    if (request.shouldLoadDeadlines) loadCalendarDeadlines();
    if (request.shouldLoadBills) loadCalendarBills({ refreshLive: true });
  }, [isMobile, calendarView, showBills, loadCalendarDeadlines, loadCalendarBills, setShellTab, setCalendarMounted]);

  const changeCalendarView = (v) => {
    const nextView = normalizeCalendarWorkspaceView(v);
    setCalendarView(nextView);
    try { localStorage.setItem("calendar:lastView", nextView); } catch { /* ignore */ }
    if (nextView === "bills") loadCalendarBills({ refreshLive: true });
  };

  useEffect(() => {
    onCalendarWorkspaceChange?.({
      open: tab === "calendar",
      view: calendarView,
      eventsRange: calendarEventsRangeRef.current,
    });
  }, [tab, calendarView, onCalendarWorkspaceChange]);

  // A dashboard deep-link is a one-shot for that single navigation: it forces
  // calendar overlays on (e.g. show-completed so a completed deadline is visible)
  // AND focuses/opens that item's detail. Once the user leaves the calendar tab,
  // drop BOTH so a later *manual* return (or a later show-completed toggle) can't
  // resurrect them — otherwise pressing "D" to show completed re-attaches the old
  // dashboard-focused detail. (The calendar also reverts its in-memory overlay
  // flags to the stored preferences on leave — see useDeadlineOverlayState.)
  const prevTabRef = useRef(tab);
  useEffect(() => {
    const leftCalendar = shouldClearCalendarFocusOnLeave({ prevTab: prevTabRef.current, tab });
    prevTabRef.current = tab;
    if (!leftCalendar) return;
    // Reacting to a tab transition (external navigation), not deriving render
    // state; functional/guarded updates no-op when already cleared. Keyed on `tab`
    // so every leave path is covered (header tabs, hotkeys, mobile fallback, back).
    /* eslint-disable react-hooks/set-state-in-effect */
    setCalendarForceOverlays((cur) => (
      cur.events || cur.deadlines || cur.completedDeadlines
        ? { events: false, deadlines: false, completedDeadlines: false }
        : cur
    ));
    setCalendarFocusItemId((cur) => (cur ? null : cur));
    setCalendarFocusOpenDetail((cur) => (cur ? false : cur));
    setCalendarFocus((cur) => (cur ? null : cur));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tab]);

  const handleCalendarEventsRangeChange = useCallback((range) => {
    calendarEventsRangeRef.current = range;
    onCalendarWorkspaceChange?.({
      open: tab === "calendar",
      view: calendarView,
      eventsRange: range,
    });
  }, [tab, calendarView, onCalendarWorkspaceChange]);

  return {
    calendarOpenRequestId,
    calendarView,
    calendarFocus,
    calendarFocusItemId,
    calendarFocusOpenDetail,
    calendarForceOverlays,
    openCalendar,
    changeCalendarView,
    handleCalendarEventsRangeChange,
  };
}
