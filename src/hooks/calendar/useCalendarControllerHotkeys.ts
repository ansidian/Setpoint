import useCalendarModalHotkeys from "./useCalendarModalHotkeys";

type CalendarHotkeyOptions = Parameters<typeof useCalendarModalHotkeys>[0];

type CalendarState = Pick<CalendarHotkeyOptions,
  | "open" | "canGoPrev" | "currentMonth" | "currentYear" | "todayDate"
  | "view" | "viewYear" | "viewMonth" | "activeView" | "itemsByDay" | "itemsByDate"
>;
type EditorState = Pick<CalendarHotkeyOptions,
  | "closeEventEditor" | "eventEditor" | "deadlineEditor" | "setDeadlineEditor"
  | "setDeadlineDraftPreview" | "floatingDetail" | "floatingDetailRef" | "setFloatingDetail"
  | "usesFloatingEditor" | "cancelFloatingEditor" | "flipFloatingDetailSide"
  | "shakeFloatingEditor" | "openFloatingEventEdit" | "openFloatingDeadlineEdit"
  | "openFloatingEventCreate" | "openFloatingDeadlineCreate"
>;
type SelectionState = Pick<CalendarHotkeyOptions,
  | "selectedItemId" | "selectedDay" | "selectedDateKey" | "setSuppressFocusRing"
  | "setSelectedDay" | "setSelectedDateKey" | "setSelectedItemId"
>;
type NavigationState = Pick<CalendarHotkeyOptions,
  | "handleViewChange" | "cycleView" | "setViewDate" | "setFetchAnchor" | "setLabelMonth"
  | "requestAgendaScroll" | "resolveSelectedAgendaEditAnchor" | "navigateMonthRef"
>;
type OverlayState = Pick<CalendarHotkeyOptions,
  | "toggleEventOverlay" | "deadlineOverlayVisible" | "toggleDeadlineOverlay"
  | "toggleCompletedDeadlineOverlay" | "setDeadlineOverlayVisible"
>;
type EventSelectionState = Pick<CalendarHotkeyOptions,
  | "onCopySelectedEvent" | "onPasteCopiedEvent" | "onDeleteSelectedEvents"
  | "onBeginEventSelectionSetFromSelected"
>;
type SearchState = Pick<CalendarHotkeyOptions, "openCalendarSearch" | "cancelCalendarSearch">;

interface CalendarControllerHotkeysOptions {
  calendar: CalendarState;
  editors: EditorState;
  selection: SelectionState;
  navigation: NavigationState;
  overlays: OverlayState;
  eventSelection: EventSelectionState;
  search: SearchState;
}

/** Keeps the controller-facing hotkey interface grouped by interaction domain. */
export default function useCalendarControllerHotkeys({
  calendar,
  editors,
  selection,
  navigation,
  overlays,
  eventSelection,
  search,
}: CalendarControllerHotkeysOptions) {
  useCalendarModalHotkeys({
    ...calendar,
    ...editors,
    ...selection,
    ...navigation,
    ...overlays,
    ...eventSelection,
    ...search,
  });
}
