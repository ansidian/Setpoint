import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveCalendarOpenState,
  shouldClearCalendarFocusOnLeave,
} from "./dashboardShellModel";
import { normalizeCalendarWorkspaceView } from "../../hooks/calendar/calendarModalInteractionModel";
import { readDemoSafeLocalStorage, writeDemoSafeLocalStorage } from "../../demo/demoSafeLocalStorage";
import type { Dispatch, SetStateAction } from "react";
import type { CalendarView } from "../../../shared/types/calendar";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { CalendarOpenOptions, DashboardTab } from "./dashboardShellModel";

export interface DashboardCalendarEventsRange { start?: string | null; end?: string | null }
export interface DashboardCalendarWorkspaceState {
  open: boolean;
  view: CalendarView;
  eventsRange: DashboardCalendarEventsRange | null;
}
interface CalendarWorkspaceOptions {
  isMobile: boolean;
  tab: DashboardTab;
  setShellTab: (tab: DashboardTab) => void;
  setCalendarMounted: Dispatch<SetStateAction<boolean>>;
  liveData: CurrentDashboardLiveData;
  loadCalendarDeadlines: (options?: { force?: boolean }) => void;
  loadCalendarBills: (options?: { force?: boolean; refreshLive?: boolean }) => void;
  onCalendarWorkspaceChange?: (workspace: DashboardCalendarWorkspaceState) => void;
}

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
}: CalendarWorkspaceOptions) {
  const [calendarOpenRequestId, setCalendarOpenRequestId] = useState(0);
  // Bumped when the active Calendar nav tab is re-tapped on mobile; the calendar
  // controller consumes the counter to scroll the agenda back to today + recenter
  // the month (the bare navigateToToday reset, overlay-preserving — same semantics
  // as re-tapping the in-agenda Events/Bills toggle).
  const [calendarJumpTodayRequestId, setCalendarJumpTodayRequestId] = useState(0);
  const [calendarView, setCalendarView] = useState<CalendarView>(() => {
    try {
      const saved = readDemoSafeLocalStorage("calendar:lastView");
      if (saved === "bills" || saved === "events") return saved;
      return "events";
    } catch { return "events"; }
  });
  const showBills = !!liveData.actualConfigured;
  const [calendarFocus, setCalendarFocus] = useState<string | null>(null);
  const [calendarFocusItemId, setCalendarFocusItemId] = useState<string | null>(null);
  const [calendarFocusOpenDetail, setCalendarFocusOpenDetail] = useState(false);
  const [calendarForceOverlays, setCalendarForceOverlays] = useState({ events: false, deadlines: false, completedDeadlines: false });
  const calendarEventsRangeRef = useRef<DashboardCalendarEventsRange | null>(null);

  // Memoized so the (memoized) AlfredPanel's onOpenCalendarItem can be stable and
  // bail out on unrelated dashboard re-renders. State setters are referentially
  // stable; deps are only the values openCalendar actually reads/calls.
  const openCalendar = useCallback((viewKey: string, focusDate: string | null = null, focusItemId: string | null = null, options: CalendarOpenOptions = {}) => {
    const request = resolveCalendarOpenState({
      viewKey,
      currentView: calendarView,
      showBills,
      focusDate,
      focusItemId,
      options,
    });
    if (!request) return;
    setCalendarView(request.view);
    writeDemoSafeLocalStorage("calendar:lastView", request.view);
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

  const jumpCalendarToToday = useCallback(() => {
    setCalendarJumpTodayRequestId((value) => value + 1);
  }, []);

  const changeCalendarView = (v: string) => {
    const nextView = normalizeCalendarWorkspaceView(v);
    setCalendarView(nextView);
    writeDemoSafeLocalStorage("calendar:lastView", nextView);
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

  const handleCalendarEventsRangeChange = useCallback((range: DashboardCalendarEventsRange | null) => {
    calendarEventsRangeRef.current = range;
    onCalendarWorkspaceChange?.({
      open: tab === "calendar",
      view: calendarView,
      eventsRange: range,
    });
  }, [tab, calendarView, onCalendarWorkspaceChange]);

  return {
    calendarOpenRequestId,
    calendarJumpTodayRequestId,
    calendarView,
    calendarFocus,
    calendarFocusItemId,
    calendarFocusOpenDetail,
    calendarForceOverlays,
    openCalendar,
    jumpCalendarToToday,
    changeCalendarView,
    handleCalendarEventsRangeChange,
  };
}
