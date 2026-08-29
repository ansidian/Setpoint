import { useRef, useState, type ReactElement } from "react";
import eventsView from "../../components/calendar/views/eventsView.tsx";
import { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.ts";
import useIsMobile from "../useIsMobile";
import { ymdFromParts } from "../../components/calendar/calendarDateUtils.ts";
import useCalendarFloatingDetail from "./useCalendarFloatingDetail";
import useDashboardDetailFocus, { type PendingDashboardDetailFocus } from "./useDashboardDetailFocus";
import useDeadlineOverlayState from "./useDeadlineOverlayState";
import type { FloatingEditorItem } from "./useFloatingEditorRouting";
import useCalendarDeadlineOverlay from "./useCalendarDeadlineOverlay";
import useAgendaSyncPolicy from "./useAgendaSyncPolicy";
import useCalendarControllerHotkeys from "./useCalendarControllerHotkeys";
import useCalendarControllerShell from "./useCalendarControllerShell";
import useCalendarEditorScrollRouting from "./useCalendarEditorScrollRouting";
import useCalendarSearchActivation from "./useCalendarSearchActivation";
import useCalendarModalSelection from "./useCalendarModalSelection";
import useCalendarModalViewModel, { type CalendarModalViewModelOptions } from "./useCalendarModalViewModel";
import useCalendarMonthNavigation from "./useCalendarMonthNavigation";
import useCalendarAgendaScroll from "./useCalendarAgendaScroll";
import useCalendarAgendaInteractions from "./useCalendarAgendaInteractions";
import useCalendarOpenRequestRouting from "./useCalendarOpenRequestRouting";
import useCalendarControllerLifecycle from "./useCalendarControllerLifecycle";
import useCalendarControllerActions from "./useCalendarControllerActions";
import useViewportWidth from "./useViewportWidth";
import { normalizeCalendarWorkspaceView } from "./calendarModalInteractionModel";
import { VIEWS } from "./calendarControllerHelpers";
import useCalendarControllerViewData, {
  type ControllerEventsData,
  type ControllerRangeData,
} from "./useCalendarControllerViewData";
import type { CalendarEventCreateRequest } from "./calendarEventCreateBridge";

export interface CalendarModalControllerOptions {
  open: boolean;
  view?: string;
  onViewChange?: (view: string) => void;
  eventsData?: ControllerEventsData | null;
  onEventsVisibleRangeChange?: (range: { start: string; end: string }) => void;
  billsData?: Record<string, unknown>;
  billsRangeData?: ControllerRangeData<Record<string, unknown>> | null;
  deadlinesData?: unknown;
  deadlinesRangeData?: ControllerRangeData<unknown> | null;
  weatherData?: unknown;
  focusDate?: string | null;
  focusItemId?: string | null;
  focusOpenDetail?: boolean;
  forceEventOverlay?: boolean;
  forceDeadlineOverlay?: boolean;
  forceCompletedDeadlineOverlay?: boolean;
  openRequestId?: number;
  jumpTodayRequestId?: number;
  deadlineActions?: Record<string, unknown>;
  eventCreateRequest?: CalendarEventCreateRequest | null;
}

export type CalendarModalControllerResult = ReactElement | null;

export default function useCalendarModalController({
  open,
  view: requestedView,
  onViewChange,
  eventsData,
  onEventsVisibleRangeChange,
  billsData,
  billsRangeData,
  deadlinesData,
  deadlinesRangeData,
  weatherData,
  focusDate,
  focusItemId,
  focusOpenDetail = false,
  forceEventOverlay = false,
  forceDeadlineOverlay = false,
  forceCompletedDeadlineOverlay = false,
  openRequestId = 0,
  jumpTodayRequestId = 0,
  deadlineActions = {},
  eventCreateRequest = null,
}: CalendarModalControllerOptions): CalendarModalControllerResult {
  const view = normalizeCalendarWorkspaceView(requestedView);
  const {
    currentMonth,
    currentYear,
    todayDate,
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
    commitSyncSnapshot: commitSelectionSyncSnapshot,
    focusDateKey,
  } = useCalendarModalSelection({
    open,
    view,
    focusDate,
    focusItemId,
    openRequestId,
  });
  const todayDateKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const viewportWidth = useViewportWidth();
  const {
    eventOverlayVisible,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    toggleEventOverlay,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
  } = useDeadlineOverlayState({
    open,
    view,
    forceEventOverlay,
    forceDeadlineOverlay,
    forceCompletedDeadlineOverlay,
    openRequestId,
  });
  const [labelMonth, setLabelMonth] = useState(() => ({ year: activeViewDate.year, month: activeViewDate.month }));
  const [manualMonthBrowseKey, setManualMonthBrowseKey] = useState(0);
  const [suppressFocusRing, setSuppressFocusRing] = useState(false);
  const [pendingItemDetailFocus, setPendingItemDetailFocus] = useState<PendingDashboardDetailFocus | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const {
    floatingDetail,
    setFloatingDetail,
    floatingDetailRef,
    findDateCell,
    openFloatingDetail,
    closeFloatingDetail,
    setFloatingDetailDragged,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setFloatingEditorDirty,
    setFloatingEditorSaveRequest,
  } = useCalendarFloatingDetail({ open, view, panelRef, railRef: contextRailRef });

  const viewMonth = activeViewDate.month;
  const viewYear = activeViewDate.year;
  const fetchYear = fetchAnchor.year;
  const fetchMonth = fetchAnchor.month;
  const activeView = VIEWS[view] || eventsView;
  const activeLayout = getCalendarLayoutMetrics(viewportWidth);
  const usesFloatingEditor = !activeLayout.stacked;

  const { suppressAgendaPassiveSync, shouldIgnorePassiveAgendaSync } = useAgendaSyncPolicy();
  const {
    agendaRailRef,
    agendaScrollCommand,
    agendaEntryTargetDateKey: effectiveAgendaEntryTargetDateKey,
    clearAgendaScrollCommand,
    requestAgendaScroll,
    setAgendaEntryScrollReleased,
  } = useCalendarAgendaScroll({
    open,
    openRequestId,
    view,
    focusDate,
    todayDateKey,
    suppressAgendaPassiveSync,
  });

  const eventsEnsureRange = eventsData?.ensureRange || null;
  const eventsRefreshRange = eventsData?.refreshRange || null;
  const eventsMutationRefreshRange = eventsData?.refreshRangeInPlace || eventsRefreshRange;
  const eventsUpsertEvents = eventsData?.upsertEvents || null;
  const eventsRemoveEvent = eventsData?.removeEvent || null;
  const eventsMarkStale = eventsData?.markStale || null;
  const eventsHasMonth = eventsData?.hasMonth || null;
  const eventsEditable = !!eventsData?.editable;
  const eventsRevision = eventsData?.revision;
  const eventsCacheStamp = eventsData?.cacheStamp ?? 0;

  const {
    sync,
    routing,
    eventEditor,
    eventEditorRef,
    isEditorDirty,
  } = useCalendarEditorScrollRouting({
    sync: {
      requestAgendaScroll, viewDate: { year: viewYear, month: viewMonth },
      firstDay: new Date(viewYear, viewMonth, 1).getDay(), setViewDate,
      setFetchAnchor, setLabelMonth, shakeEditor: shakeFloatingEditor,
    },
    routing: {
      activeSelectedDateKey, activeView, findDateCell, floatingDetailRef, focusDate,
      focusItemId, forceDeadlineOverlay, open, openFloatingDetail, selectedDay,
      selectedItemId, setFloatingDetail, setSelectedDateKey, setSelectedDay,
      setSelectedItemId, suppressAgendaPassiveSync, todayDateKey, view, viewMonth, viewYear,
    },
    event: {
      open, view, editable: eventsEditable, selectedDay: activeSelectedDay,
      selectedDate: view === "events" ? activeSelectedDateKey : null, viewYear, viewMonth,
      refreshRange: eventsMutationRefreshRange as never, upsertEvents: eventsUpsertEvents as never,
      removeEvent: eventsRemoveEvent as never, onFocusDate: focusDateKey,
    },
    floatingDetailRef,
  });
  const {
    deadlineEditor,
    deadlineDraftPreview,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    cancelFloatingEditor,
    handleFloatingDeadlineDeleted,
    handleFloatingDeadlineSaved,
    openFloatingDeadlineCreate,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingEventEdit,
  } = routing;

  const openEventCreate = eventEditor.openCreate;
  const closeEventEditor = eventEditor.closeEditor;
  const deadlinesEnsureRange = deadlinesRangeData?.ensureRange;

  const monthNavigation = useCalendarMonthNavigation({
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
  });

  // Planning-readiness state machine + deadline-overlay derivation/stabilization
  // and the per-settle committed-overlay record (extracted to keep the
  // controller under the maintainability guardrail; behavior-identical).
  const {
    planningReadiness,
    committedDeadlineOverlayData,
    lateDeadlineOverlayData,
    deadlineOverlay,
  } = useCalendarDeadlineOverlay({
    open,
    view,
    fetchYear,
    fetchMonth,
    viewYear,
    viewMonth,
    currentYear,
    currentMonth,
    scrollDrivenRef: monthNavigation.scrollDrivenRef,
    scrollDirectionRef: monthNavigation.scrollDirectionRef,
    fetchAbortRef,
    eventsEnsureRange: eventsEnsureRange ?? undefined,
    eventsRevision: eventsRevision ?? 0,
    eventEditorIsEditorOpen: eventEditor.isEditorOpen,
    onEventsVisibleRangeChange,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    deadlinesEnsureRange,
    deadlinesRangeData,
    deadlinesData,
  });

  const { visibleCalendarEvents, visibleGetMonthEvents, viewData } = useCalendarControllerViewData({
    view,
    viewYear,
    viewMonth,
    eventOverlayVisible,
    eventsData,
    deadlineOverlayVisible,
    committedDeadlineOverlayData,
    deadlinesRangeData,
    planningReadiness,
    deadlinesData,
    deadlineOverlay,
    billsData,
    billsRangeData,
  });

  const {
    eventQuickActions,
    clearCalendarEventSelectionSet,
    copySelectedCalendarEvent,
    pasteCopiedCalendarEvent,
    requestSelectedCalendarEventDelete,
    addSelectedCalendarEventToSelectionSet,
    deadlineQuickActions,
    handleViewChange,
    availableCalendarViews,
    cycleView,
    focusDeadlineTask,
  } = useCalendarControllerActions({
    eventSelection: {
      view, activeView, activeLayout, visibleCalendarEvents, activeSelectedItemId,
      activeSelectedDateKey, selectedItemId, eventsEditable,
      eventsRefreshRange: eventsMutationRefreshRange,
      eventsUpsertEvents, eventsRemoveEvent, eventsMarkStale, floatingDetailRef,
      setFloatingDetail, setSelectedItemId, setSelectedDay, setSelectedDateKey,
      closeEventEditor, shakeFloatingEditor, agendaRailRef,
    },
    deadline: {
      open, view, overlayVisible: deadlineOverlayVisible, layout: activeLayout,
      actions: deadlineActions, activeSelectedDateKey, setSelectedDay,
      setSelectedDateKey, setSelectedItemId, setDeadlineEditor,
      setDeadlineDraftPreview, setFloatingDetail, openFloatingDeadlineEdit,
      handleFloatingDeadlineDeleted,
    },
    workspace: {
      view, onViewChange, billsAvailable: !!billsRangeData?.ensureRange,
      floatingDetailRef, setFloatingDetail, shakeFloatingEditor, focusDateKey,
      setSelectedItemId, setDeadlineEditor, setDeadlineDraftPreview,
    },
  });

  const agendaInteractions = useCalendarAgendaInteractions({
    view,
    viewYear,
    viewMonth,
    activeView,
    selection: { setSelectedDay, setSelectedDateKey, setSelectedItemId, setViewDate, setFetchAnchor, setLabelMonth },
    editor: {
      isDirty: isEditorDirty,
      closeEventEditor,
      clearEventSelectionSet: clearCalendarEventSelectionSet,
      closeDeadlineEditor: () => {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      },
      shakeEditor: shakeFloatingEditor,
      openEventCreate: openFloatingEventCreate,
    },
    floating: { detailRef: floatingDetailRef, openDetail: openFloatingDetail, setDetail: setFloatingDetail },
    scroll: {
      railRef: agendaRailRef,
      requestScroll: requestAgendaScroll,
      releaseEntryScroll: setAgendaEntryScrollReleased,
      suppressPassiveSync: suppressAgendaPassiveSync,
      shouldIgnorePassiveSync: shouldIgnorePassiveAgendaSync,
      onPassiveScroll: sync.onAgendaScroll,
    },
  });

  useCalendarOpenRequestRouting({
    request: {
      open, view, openRequestId, focusDate, focusItemId, forceDeadlineOverlay,
      usesFloatingEditor, activeSelectedDateKey, todayDateKey, eventCreateRequest,
    },
    syncSnapshot,
    commitSyncSnapshot: commitSelectionSyncSnapshot,
    clearAgendaScrollCommand,
    editors: {
      eventEditorEditable: eventEditor.editable,
      closeEventEditor,
      openEventCreate,
      openFloatingEventCreate,
      openFloatingDeadlineCreate,
      setDeadlineEditor,
      setDeadlineDraftPreview,
    },
    floating: { detailRef: floatingDetailRef, setDetail: setFloatingDetail },
  });

  const viewModel = useCalendarModalViewModel({
    open,
    view,
    viewData,
    visibleCalendarEvents,
    deadlineOverlay,
    activeView: activeView as unknown as CalendarModalViewModelOptions["activeView"],
    activeLayout: activeLayout as unknown as CalendarModalViewModelOptions["activeLayout"],
    currentYear,
    currentMonth,
    viewYear,
    viewMonth,
    labelYear: labelMonth.year,
    labelMonthValue: labelMonth.month,
    activeSelectedDay,
    activeSelectedDateKey,
    activeSelectedItemId,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    weatherData,
    floatingDetail: floatingDetail as unknown as CalendarModalViewModelOptions["floatingDetail"],
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    manualMonthBrowseKey,
  });
  const { canGoPrev, computed, itemsByDay } = viewModel;

  const { calendarSearch, calendarSearchShell } = useCalendarSearchActivation({
    open,
    view,
    onViewChange,
    viewYear,
    viewMonth,
    activeView,
    computed,
    eventOverlayVisible,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    floatingDetailRef,
    eventEditor,
    closeEventEditor,
    shakeFloatingEditor,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    setFloatingDetail,
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    setPendingItemDetailFocus,
    panelRef,
    activeSelectedDateKey,
    activeSelectedItemId,
  });

  const shellViewData = viewData;
  const isMobile = useIsMobile();
  const domainEnsureRange = "ensureRange" in viewData ? viewData.ensureRange : undefined;
  useCalendarControllerLifecycle({
    open,
    view,
    fetchYear,
    fetchMonth,
    completedDeadlineOverlayVisible,
    activeView,
    computed,
    viewData: { ensureRange: domainEnsureRange as never, revision: viewData.revision },
    selection: {
      activeDateKey: activeSelectedDateKey,
      activeItemId: activeSelectedItemId,
      setDateKey: setSelectedDateKey,
      setDay: setSelectedDay,
      setItemId: setSelectedItemId,
    },
    floating: { detail: floatingDetail, detailRef: floatingDetailRef, setDetail: setFloatingDetail },
    eventEditor: {
      editable: eventEditor.editable,
      isOpen: eventEditor.isEditorOpen,
      prefetchSources: eventEditor.prefetchSources,
    },
    mobileTodayRequest: { id: jumpTodayRequestId, isMobile, navigateToToday: sync.navigateToToday },
  });

  useDashboardDetailFocus({
    open,
    view,
    focusOpenDetail,
    focusItemId,
    focusDate,
    openRequestId,
    forceDeadlineOverlay,
    usesFloatingEditor,
    activeView,
    computed,
    activeSelectedDateKey,
    floatingDetailRef,
    panelRef,
    agendaRailRef,
    shakeFloatingEditor,
    suppressAgendaPassiveSync,
    openFloatingDetail,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    pendingItemDetailFocus,
    setPendingItemDetailFocus,
  });

  useCalendarControllerHotkeys({
    calendar: {
      open, canGoPrev, currentMonth, currentYear, todayDate, view, viewYear, viewMonth,
      activeView, itemsByDay,
      itemsByDate: (computed.itemsByDate || {}) as Record<string, FloatingEditorItem[]>,
    },
    editors: {
      closeEventEditor, eventEditor, deadlineEditor, setDeadlineEditor, setDeadlineDraftPreview,
      floatingDetail, floatingDetailRef, setFloatingDetail, usesFloatingEditor,
      cancelFloatingEditor, flipFloatingDetailSide, shakeFloatingEditor,
      openFloatingEventEdit, openFloatingDeadlineEdit, openFloatingEventCreate,
      openFloatingDeadlineCreate,
    },
    selection: {
      selectedItemId, selectedDay, selectedDateKey, setSuppressFocusRing,
      setSelectedDay, setSelectedDateKey, setSelectedItemId,
    },
    navigation: {
      handleViewChange, cycleView, setViewDate, setFetchAnchor, setLabelMonth,
      requestAgendaScroll,
      resolveSelectedAgendaEditAnchor: agendaInteractions.resolveSelectedAgendaEditAnchor,
      navigateMonthRef: monthNavigation.navigateMonthRef,
    },
    overlays: {
      toggleEventOverlay, deadlineOverlayVisible, toggleDeadlineOverlay,
      toggleCompletedDeadlineOverlay,
      setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
    },
    eventSelection: {
      onCopySelectedEvent: copySelectedCalendarEvent,
      onPasteCopiedEvent: pasteCopiedCalendarEvent,
      onDeleteSelectedEvents: requestSelectedCalendarEventDelete,
      onBeginEventSelectionSetFromSelected: addSelectedCalendarEventToSelectionSet,
    },
    search: {
      openCalendarSearch: calendarSearch.openSearch,
      cancelCalendarSearch: calendarSearch.cancelSearch,
    },
  });

  return useCalendarControllerShell({
    open, isMobile, eventEditor,
    editorOverlays: {
      view, eventOverlayVisible, toggleEventOverlay, deadlineOverlayVisible,
      completedDeadlineOverlayVisible, planningReadiness,
      lateDeadlinesReady: !!lateDeadlineOverlayData, toggleDeadlineOverlay,
      toggleCompletedDeadlineOverlay, onApplyLateDeadlines: deadlineOverlay?.onApplyLateDeadlines,
    },
    editorState: { deadlineEditor, setDeadlineEditor, setDeadlineDraftPreview },
    refs: { panelRef, scrollRef, agendaRailRef, contextRailRef },
    viewState: { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, suppressFocusRing },
    data: { activeView, viewData: shellViewData, weatherData, isMonthCached: eventsHasMonth, getMonthEvents: visibleGetMonthEvents, getMonthDeadlines: deadlinesRangeData?.getMonthData || null, eventsRange: eventsData || null, deadlinesRange: deadlinesRangeData || null, dataRevision: eventsCacheStamp + (deadlinesRangeData?.revision ?? 0), getMonthBills: billsRangeData?.getMonthData || null, billsRange: billsRangeData || null, billsDataRevision: billsRangeData?.revision ?? 0 },
    viewModel,
    selection: { activeSelectedDay, activeSelectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId, setViewDate },
    quickActions: { eventQuickActions, deadlineQuickActions },
    agenda: {
      agendaScrollCommand,
      agendaEntryTargetDateKey: effectiveAgendaEntryTargetDateKey,
      onAgendaPassiveDateChange: agendaInteractions.onAgendaPassiveDateChange,
      onAgendaDateAction: agendaInteractions.onAgendaDateAction,
      onMiniCalendarDateAction: agendaInteractions.onMiniCalendarDateAction,
      onMiniCalendarDateCreate: agendaInteractions.onMiniCalendarDateCreate,
      onAgendaEventAction: agendaInteractions.onAgendaEventAction,
      scrollAgendaToDate: agendaInteractions.scrollAgendaToDate,
      scrollAgendaToEvent: agendaInteractions.scrollAgendaToEvent,
    },
    floating: {
      floatingDetail, openFloatingDetail, closeFloatingDetail, setFloatingDetailDragged,
      openFloatingEventCreate, openFloatingEventEdit, openFloatingDeadlineCreate, openFloatingDeadlineEdit,
      cancelFloatingEditor, setFloatingEditorDirty, setFloatingEditorSaveRequest, shakeFloatingEditor,
      handleFloatingDeadlineSaved, handleFloatingDeadlineDeleted,
    },
    handlers: {
      navigateMonth: monthNavigation.navigateMonth,
      jumpToMonth: monthNavigation.jumpToMonth,
      handleViewChange,
      closeEventEditor,
      focusDeadlineTask,
      onDisplayMonthChange: monthNavigation.onDisplayMonthChange,
      onLabelMonthChange: monthNavigation.onLabelMonthChange,
      onFetchSettle: monthNavigation.onFetchSettle,
      navigateToDate: sync.navigateToDate,
      navigateToMonth: sync.navigateToMonth,
      navigateToToday: sync.navigateToToday,
    },
    search: calendarSearchShell,
    availableCalendarViews,
  });
}
