// Adapts the controller's internal bundles to the CalendarModalShell prop
// contract. Props stay grouped end-to-end; this layer only renames
// controller-internal fields to shell-facing ones and derives small defaults.
import type { CalendarModalShellProps, CalendarShellComputed } from "./CalendarModalShell";

type ShellSelection = CalendarModalShellProps["selection"];
type ShellFloating = CalendarModalShellProps["floating"];
type ShellHandlers = CalendarModalShellProps["handlers"];

export interface BuildCalendarModalShellPropsInput {
  refs: CalendarModalShellProps["refs"];
  viewState: CalendarModalShellProps["viewState"];
  data: Omit<CalendarModalShellProps["data"], "HeaderExtras">;
  viewModel: Omit<CalendarModalShellProps["viewModel"], "itemsByDate" | "cellMetaByDate"> & {
    computed: CalendarShellComputed;
  };
  selection: {
    activeSelectedDay: ShellSelection["selectedDay"];
    activeSelectedDateKey: ShellSelection["selectedDateKey"];
    setSelectedDay: ShellSelection["setSelectedDay"];
    setSelectedDateKey: ShellSelection["setSelectedDateKey"];
    setSelectedItemId: ShellSelection["setSelectedItemId"];
  };
  editors: {
    eventEditor: CalendarModalShellProps["editors"]["eventEditor"];
    deadlineEditor: CalendarModalShellProps["editors"]["deadlineEditor"];
    setDeadlineEditor: CalendarModalShellProps["editors"]["setDeadlineEditor"];
    setDeadlineDraftPreview: CalendarModalShellProps["editors"]["onDeadlineDraftPreviewChange"];
  };
  quickActions: CalendarModalShellProps["quickActions"];
  agenda: {
    agendaScrollCommand?: unknown;
    agendaEntryTargetDateKey?: string | null;
    onAgendaPassiveDateChange?: (...args: unknown[]) => void;
    onAgendaDateAction?: (...args: unknown[]) => void;
    onAgendaEventAction?: (...args: unknown[]) => void;
    onMiniCalendarDateAction?: (...args: unknown[]) => void;
    onMiniCalendarDateCreate?: (...args: unknown[]) => void;
    scrollAgendaToDate?: (dateKey: string) => void;
    scrollAgendaToEvent?: (itemId: unknown, dateKey: string) => void;
  };
  floating: {
    floatingDetail: ShellFloating["floatingDetail"];
    openFloatingDetail: ShellFloating["onOpenFloatingDetail"];
    closeFloatingDetail: ShellFloating["onCloseFloatingDetail"];
    setFloatingDetailDragged: ShellFloating["onFloatingDetailDragged"];
    openFloatingEventCreate: ShellFloating["onOpenFloatingEventCreate"];
    openFloatingEventEdit: ShellFloating["onOpenFloatingEventEdit"];
    openFloatingDeadlineCreate: ShellFloating["onOpenFloatingDeadlineCreate"];
    openFloatingDeadlineEdit: ShellFloating["onOpenFloatingDeadlineEdit"];
    cancelFloatingEditor: ShellFloating["onCancelFloatingEditor"];
    setFloatingEditorDirty: ShellFloating["onFloatingEditorDirtyChange"];
    setFloatingEditorSaveRequest: ShellFloating["onFloatingEditorSaveRequest"];
    shakeFloatingEditor: ShellFloating["onShakeFloatingEditor"];
    handleFloatingDeadlineSaved: ShellFloating["onFloatingDeadlineSaved"];
    handleFloatingDeadlineDeleted: ShellFloating["onFloatingDeadlineDeleted"];
  };
  handlers: {
    navigateMonth: ShellHandlers["navigateMonth"];
    jumpToMonth: ShellHandlers["jumpToMonth"];
    handleViewChange: ShellHandlers["onViewChange"];
    closeEventEditor: CalendarModalShellProps["editors"]["closeEventEditor"];
    focusDeadlineTask: ShellHandlers["focusDeadlineTask"];
    onDisplayMonthChange: ShellHandlers["onDisplayMonthChange"];
    onLabelMonthChange: ShellHandlers["onLabelMonthChange"];
    onFetchSettle: ShellHandlers["onFetchSettle"];
    navigateToToday?: () => void;
  };
  search: CalendarModalShellProps["search"];
  availableCalendarViews?: string[];
}

export default function buildCalendarModalShellProps({
  refs,
  viewState,
  data,
  viewModel,
  selection,
  editors,
  quickActions,
  agenda,
  floating,
  handlers,
  search,
  availableCalendarViews,
}: BuildCalendarModalShellPropsInput): CalendarModalShellProps {
  return {
    refs: {
      panelRef: refs.panelRef,
      scrollRef: refs.scrollRef,
      contextRailRef: refs.contextRailRef,
      agendaRailRef: refs.agendaRailRef,
    },
    viewState: {
      view: viewState.view,
      viewYear: viewState.viewYear,
      viewMonth: viewState.viewMonth,
      currentYear: viewState.currentYear,
      currentMonth: viewState.currentMonth,
      todayDate: viewState.todayDate,
      suppressFocusRing: viewState.suppressFocusRing,
    },
    viewModel: {
      panelWidth: viewModel.panelWidth,
      layout: viewModel.layout,
      monthName: viewModel.monthName,
      monthYear: viewModel.monthYear,
      canGoPrev: viewModel.canGoPrev,
      computed: viewModel.computed,
      itemsByDay: viewModel.itemsByDay,
      itemsByDate: viewModel.computed.itemsByDate || {},
      cellMetaByDate: viewModel.computed.cellMetaByDate || {},
      showGridSkeleton: viewModel.showGridSkeleton,
      buildFallbackDayState: viewModel.buildFallbackDayState,
      showDetail: viewModel.showDetail,
      showEmptySelection: viewModel.showEmptySelection,
      effectiveSelectedItemId: viewModel.effectiveSelectedItemId,
      selectedDayState: viewModel.selectedDayState,
      selectedItems: viewModel.selectedItems,
      ghostPreview: viewModel.ghostPreview,
      floatingDetailLabel: viewModel.floatingDetailLabel,
    },
    data: {
      activeView: data.activeView,
      HeaderExtras: data.activeView.HeaderExtras,
      viewData: data.viewData,
      weatherData: data.weatherData,
      isMonthCached: data.isMonthCached,
      getMonthEvents: data.getMonthEvents,
      getMonthDeadlines: data.getMonthDeadlines,
      eventsRange: data.eventsRange,
      deadlinesRange: data.deadlinesRange,
      dataRevision: data.dataRevision,
      getMonthBills: data.getMonthBills,
      billsRange: data.billsRange,
      billsDataRevision: data.billsDataRevision,
    },
    selection: {
      selectedDay: selection.activeSelectedDay,
      selectedDateKey: selection.activeSelectedDateKey,
      setSelectedDay: selection.setSelectedDay,
      setSelectedDateKey: selection.setSelectedDateKey,
      setSelectedItemId: selection.setSelectedItemId,
    },
    editors: {
      eventEditor: editors.eventEditor,
      deadlineEditor: editors.deadlineEditor,
      setDeadlineEditor: editors.setDeadlineEditor,
      closeEventEditor: handlers.closeEventEditor,
      onDeadlineDraftPreviewChange: editors.setDeadlineDraftPreview,
    },
    quickActions: {
      eventQuickActions: quickActions.eventQuickActions,
      deadlineQuickActions: quickActions.deadlineQuickActions,
    },
    agenda: {
      agendaScrollCommand: agenda.agendaScrollCommand,
      agendaEntryTargetDateKey: agenda.agendaEntryTargetDateKey,
      onAgendaPassiveDateChange: agenda.onAgendaPassiveDateChange,
      onAgendaDateAction: agenda.onAgendaDateAction,
      onAgendaEventAction: agenda.onAgendaEventAction,
      miniCalendarActions: {
        onDateAction: agenda.onMiniCalendarDateAction,
        onDateCreate: agenda.onMiniCalendarDateCreate,
      },
      onAgendaDirtyBlocked: floating.shakeFloatingEditor,
      onGridDateAction: agenda.scrollAgendaToDate,
      onGridEventAction: agenda.scrollAgendaToEvent,
    },
    floating: {
      floatingDetail: floating.floatingDetail,
      onOpenFloatingDetail: floating.openFloatingDetail,
      onCloseFloatingDetail: floating.closeFloatingDetail,
      onFloatingDetailDragged: floating.setFloatingDetailDragged,
      onOpenFloatingEventCreate: floating.openFloatingEventCreate,
      onOpenFloatingEventEdit: floating.openFloatingEventEdit,
      onOpenFloatingDeadlineCreate: floating.openFloatingDeadlineCreate,
      onOpenFloatingDeadlineEdit: floating.openFloatingDeadlineEdit,
      onCancelFloatingEditor: floating.cancelFloatingEditor,
      onFloatingEditorDirtyChange: floating.setFloatingEditorDirty,
      onFloatingEditorSaveRequest: floating.setFloatingEditorSaveRequest,
      onShakeFloatingEditor: floating.shakeFloatingEditor,
      onFloatingDeadlineSaved: floating.handleFloatingDeadlineSaved,
      onFloatingDeadlineDeleted: floating.handleFloatingDeadlineDeleted,
    },
    handlers: {
      navigateMonth: handlers.navigateMonth,
      jumpToMonth: handlers.jumpToMonth,
      onViewChange: handlers.handleViewChange,
      focusDeadlineTask: handlers.focusDeadlineTask,
      onDisplayMonthChange: handlers.onDisplayMonthChange,
      onLabelMonthChange: handlers.onLabelMonthChange,
      onFetchSettle: handlers.onFetchSettle,
      // Mobile agenda reuses the controller's jump-to-today reset (re-tap toggle /
      // "Today" strip pill). Desktop CalendarModalShell ignores this handler.
      navigateToToday: handlers.navigateToToday,
    },
    search,
    availableCalendarViews: availableCalendarViews ?? ["events"],
  };
}
