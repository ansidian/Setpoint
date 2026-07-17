import { Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import eventsView from "../../components/calendar/views/eventsView.tsx";
import { getCalendarLayoutMetrics } from "../../components/calendar/calendarLayout.ts";
import useCalendarEventEditor from "../../components/calendar/events/useCalendarEventEditor";
import useDeadlineQuickActions, { type UseDeadlineQuickActionsOptions } from "../../components/calendar/views/deadlines/useDeadlineQuickActions.ts";
import { getDeadlineSelectionId } from "../../components/calendar/views/deadlines/deadlinesModel.ts";
import buildCalendarModalShellProps, { type BuildCalendarModalShellPropsInput } from "../../components/calendar/modal/buildCalendarModalShellProps";
import useIsMobile from "../useIsMobile";
import { CalendarMobileAgenda, CalendarModalShell } from "./calendarShellLoaders";
import {
  getMultiMonthGridRange,
  getVisibleGridRange,
  parseYmd,
  ymdFromParts,
} from "../../components/calendar/calendarDateUtils.ts";
import useCalendarEventSelectionSet from "./useCalendarEventSelectionSet";
import useCalendarFloatingDetail, { type CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import useDashboardDetailFocus, { type PendingDashboardDetailFocus } from "./useDashboardDetailFocus";
import useDeadlineOverlayState from "./useDeadlineOverlayState";
import useFloatingEditorRouting, { type FloatingEditorItem } from "./useFloatingEditorRouting";
import useCalendarDeadlineOverlay from "./useCalendarDeadlineOverlay";
import useAgendaSyncPolicy from "./useAgendaSyncPolicy";
import useCalendarModalHotkeys from "./useCalendarModalHotkeys";
import useCalendarSearchActivation from "./useCalendarSearchActivation";
import useCalendarModalSelection from "./useCalendarModalSelection";
import useCalendarModalViewModel, { type CalendarModalViewModelOptions } from "./useCalendarModalViewModel";
import useCalendarMonthNavigation from "./useCalendarMonthNavigation";
import useCalendarScrollSync, { type AgendaScrollCommand } from "./useCalendarScrollSync";
import useViewportWidth from "./useViewportWidth";
import { normalizeCalendarWorkspaceView, nextCalendarView } from "./calendarModalInteractionModel";
import type { CalendarModalSyncSnapshot } from "./calendarModalSelectionModel";
import {
  addMonthOffset,
  dedupeEvents,
  EMPTY_CALENDAR_EVENTS,
  findItemLocation,
  isCompleteItem,
  itemMatchesViewId,
  type CalendarControllerItem,
  VIEWS,
} from "./calendarControllerHelpers";
import { computeCalendarEntryReadiness } from "./calendarEntryReadinessModel";
import { computeCalendarBillsViewData } from "./calendarBillsViewDataModel";

// The scroll grid mounts the active month ± 2 (see mountedWindow). Ensure bills
// for that whole grid window so every mounted month's cells (and their spill
// from adjacent months) resolve; month-mode caching fetches it in <=2-month
// chunks and reuses cached months as you scroll.
const BILLS_FETCH_MONTH_RADIUS = 2;

interface ControllerEventsData {
  ensureRange?: (start: string, end: string, options?: { signal?: AbortSignal; prefetchKeys?: string[] }) => Promise<unknown>;
  refreshRange?: (...args: never[]) => unknown;
  upsertEvents?: (...args: never[]) => unknown;
  removeEvent?: (...args: never[]) => unknown;
  markStale?: (...args: never[]) => unknown;
  getEvents?: (year: number, month: number) => Array<Partial<NormalizedCalendarEvent> & { id?: string | number }>;
  hasMonth?: (year: number, month: number) => boolean;
  isMonthLoading?: (year: number, month: number) => boolean;
  editable?: boolean;
  loading?: boolean;
  staleRefreshPending?: boolean;
  revision?: number;
  cacheStamp?: number;
  [key: string]: unknown;
}

interface ControllerRangeData<T = unknown> {
  ensureRange?: (start: string, end: string) => Promise<T>;
  getMonthData?: (...args: never[]) => unknown;
  data?: T | null;
  dataRange?: { start: string; end: string } | null;
  revision?: number;
  loading?: boolean;
  error?: unknown;
  [key: string]: unknown;
}

interface AgendaRailHandle {
  scrollToToday?: (id: string) => void;
  scrollToDate?: (dateKey: string, id: string) => void;
  scrollToItem?: (itemId: string | number, dateKey: string, id: string) => void;
  activateItem?: (itemId: string, dateKey: string) => boolean;
  getItemAnchor?: (itemId: string | number, dateKey: string | null) => HTMLElement | null;
  scrollToEvent?: (itemId: string | number | null, dateKey: string) => void;
}

type ControllerAgendaCommand = (AgendaScrollCommand | { type: "event" | "item"; itemId: string | number; dateKey: string }) & { id?: string };

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
  const [agendaScrollCommand, setAgendaScrollCommand] = useState<(ControllerAgendaCommand & { id: string }) | null>(null);
  const [agendaEntryScrollReleased, setAgendaEntryScrollReleased] = useState(false);
  const [pendingItemDetailFocus, setPendingItemDetailFocus] = useState<PendingDashboardDetailFocus | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const agendaRailRef = useRef<AgendaRailHandle | null>(null);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const handledInitialDeadlineCreateRef = useRef<string | null>(null);
  const eventEditorRef = useRef<ReturnType<typeof useCalendarEventEditor> | null>(null);
  const agendaSelectionAnchorRef = useRef<{ itemId: string | null; dateKey: string; anchorKind: string } | null>(null);
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

  function isEditorDirty() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty)
      || (eventEditorRef.current?.isEditorOpen && eventEditorRef.current?.isDirty)
    );
  }
  function isEditorOpen() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create"))
      || eventEditorRef.current?.isEditorOpen
      || deadlineEditor?.mode
    );
  }
  const { suppressAgendaPassiveSync, shouldIgnorePassiveAgendaSync } = useAgendaSyncPolicy();

  const requestAgendaScroll = useCallback((command: ControllerAgendaCommand) => {
    if (!command) return;
    suppressAgendaPassiveSync();
    setAgendaEntryScrollReleased(true);
    const scrollCommand = {
      ...command,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    setAgendaScrollCommand(scrollCommand);
    window.requestAnimationFrame(() => {
      const rail = agendaRailRef.current;
      if (!rail) return;
      if (scrollCommand.type === "today") {
        rail.scrollToToday?.(scrollCommand.id);
      } else if (scrollCommand.type === "date") {
        rail.scrollToDate?.(scrollCommand.dateKey, scrollCommand.id);
      } else if (scrollCommand.type === "event" || scrollCommand.type === "item") {
        rail.scrollToItem?.(scrollCommand.itemId, scrollCommand.dateKey, scrollCommand.id);
      }
    });
  }, [suppressAgendaPassiveSync]);

  const sync = useCalendarScrollSync({
    requestAgendaScroll,
    viewDate: { year: viewYear, month: viewMonth },
    firstDay: new Date(viewYear, viewMonth, 1).getDay(),
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    isDirtyCheck: isEditorDirty,
    isEditorOpenCheck: isEditorOpen,
    shakeEditor: shakeFloatingEditor,
  });
  const agendaEntryTargetDateKey = useMemo(() => {
    if (!open) return null;
    if (focusDate && parseYmd(focusDate)) return focusDate;
    return todayDateKey;
  }, [focusDate, open, todayDateKey]);
  const effectiveAgendaEntryTargetDateKey = agendaEntryScrollReleased ? false : agendaEntryTargetDateKey;
  const eventsEnsureRange = eventsData?.ensureRange || null;
  const eventsRefreshRange = eventsData?.refreshRange || null;
  const eventsUpsertEvents = eventsData?.upsertEvents || null;
  const eventsRemoveEvent = eventsData?.removeEvent || null;
  const eventsMarkStale = eventsData?.markStale || null;
  const eventsGetEvents = eventsData?.getEvents || null;
  const eventsHasMonth = eventsData?.hasMonth || null;
  const eventsIsMonthLoading = eventsData?.isMonthLoading || null;
  const eventsEditable = !!eventsData?.editable;
  const eventsLoading = !!eventsData?.loading;
  const eventsStaleRefreshPending = !!eventsData?.staleRefreshPending;
  const eventsRevision = eventsData?.revision;
  const eventsCacheStamp = eventsData?.cacheStamp ?? 0;

  function focusEditorDate(ymd: string) {
    focusDateKey(ymd);
  }

  const {
    deadlineEditor,
    deadlineDraftPreview,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    cancelFloatingEditor,
    handleEventEditorDeleted,
    handleEventEditorSaved,
    handleFloatingDeadlineDeleted,
    handleFloatingDeadlineSaved,
    openFloatingDeadlineCreate,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingEventEdit,
  } = useFloatingEditorRouting({
    activeSelectedDateKey,
    activeView,
    eventEditorRef,
    findDateCell,
    floatingDetailRef,
    focusDate,
    focusItemId,
    forceDeadlineOverlay,
    open,
    openFloatingDetail,
    selectedDay,
    selectedItemId,
    setFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    suppressAgendaPassiveSync,
    todayDateKey,
    view,
    viewMonth,
    viewYear,
  });

  const eventEditor = useCalendarEventEditor({
    open,
    view,
    editable: eventsEditable,
    selectedDay: activeSelectedDay,
    selectedDate: view === "events" ? activeSelectedDateKey : null,
    viewYear,
    viewMonth,
    refreshRange: (eventsRefreshRange as ((start: string, end: string) => unknown) | null) ?? undefined,
    upsertEvents: (eventsUpsertEvents as ((events: NormalizedCalendarEvent | NormalizedCalendarEvent[]) => void) | null) ?? undefined,
    removeEvent: (eventsRemoveEvent as ((eventId: string) => void) | null) ?? undefined,
    onFocusDate: focusEditorDate,
    onSaved: handleEventEditorSaved,
    onDeleted: handleEventEditorDeleted,
  });

  const openEventCreate = eventEditor.openCreate;
  const prefetchEventSources = eventEditor.prefetchSources;

  useLayoutEffect(() => {
    eventEditorRef.current = eventEditor;
  }, [eventEditor]);

  useEffect(() => {
    if (!eventEditor.editable || typeof window === "undefined") return undefined;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchEventSources(), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => prefetchEventSources(), 400);
    return () => window.clearTimeout(id);
  }, [open, view, eventEditor.editable, prefetchEventSources]);

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

  // The three-month event window used to be built inline inside the viewData
  // memo, so every status churn (loading toggles, readiness transitions,
  // per-settle commits) handed grids, previews, and the agenda rail fresh
  // identities for unchanged data. It is memoized separately so viewData
  // rebuilds cannot invalidate downstream memos unless the underlying events
  // actually changed.
  const visibleCalendarEvents = useMemo(() => {
    if (view !== "events" || !eventOverlayVisible || !eventsGetEvents) return EMPTY_CALENDAR_EVENTS;
    const prevMonth = addMonthOffset(viewYear, viewMonth, -1);
    const nextMonth = addMonthOffset(viewYear, viewMonth, 1);
    return dedupeEvents([
      ...(eventsGetEvents(prevMonth.year, prevMonth.month) || []),
      ...(eventsGetEvents(viewYear, viewMonth) || []),
      ...(eventsGetEvents(nextMonth.year, nextMonth.month) || []),
    ]);
    // eventsCacheStamp invalidates the ref-backed eventsGetEvents reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, eventOverlayVisible, eventsGetEvents, viewYear, viewMonth, eventsCacheStamp]);

  const viewData = useMemo(() => {
    if (view === "events") {
      const { eventsRangeLoading, agendaEntryReady } = computeCalendarEntryReadiness({
        viewYear,
        viewMonth,
        eventsLoading,
        eventsIsMonthLoading,
        eventsEnsureRange: eventsEnsureRange as never,
        deadlineOverlayVisible,
        committedDeadlineOverlayData,
        deadlinesEnsureRange: deadlinesRangeData?.ensureRange as never,
        deadlinesSeedData: deadlinesRangeData?.data,
        deadlinesDataRange: deadlinesRangeData?.dataRange ?? null,
        planningReadiness,
        deadlinesData,
      });
      return {
        events: visibleCalendarEvents,
        deadlineOverlay,
        planningReadiness,
        isLoading: eventsRangeLoading,
        agendaEntryReady,
        pendingUpdate: eventsStaleRefreshPending,
        hasMonth: eventsHasMonth?.(viewYear, viewMonth) || false,
        revision: eventsRevision,
      };
    }
    return computeCalendarBillsViewData({ billsData, billsRangeData: billsRangeData as never });
  }, [
    view,
    eventsEnsureRange,
    eventsHasMonth,
    eventsIsMonthLoading,
    eventsLoading,
    eventsStaleRefreshPending,
    eventsRevision,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    committedDeadlineOverlayData,
    deadlinesRangeData?.ensureRange,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    planningReadiness,
    deadlinesData,
    visibleCalendarEvents,
    deadlineOverlay,
    billsData,
    billsRangeData,
  ]);

  useLayoutEffect(() => {
    if (
      !open
      || view !== "events"
      || completedDeadlineOverlayVisible
      || !floatingDetail?.open
      || floatingDetail.detailKind !== "deadline"
    ) return;
    const snapshotItem = (floatingDetail.itemsSnapshot || []).find((item) => (
      itemMatchesViewId(activeView, item as unknown as CalendarControllerItem, floatingDetail.itemId)
    )) as FloatingEditorItem | undefined;
    if (!isCompleteItem(snapshotItem as unknown as CalendarControllerItem | undefined)) return;
    setFloatingDetail(null);
    setSelectedItemId(null);
  }, [
    activeView,
    completedDeadlineOverlayVisible,
    floatingDetail,
    open,
    setFloatingDetail,
    setSelectedItemId,
    view,
  ]);

  const {
    eventQuickActions,
    clearCalendarEventSelectionSet,
    copySelectedCalendarEvent,
    pasteCopiedCalendarEvent,
    requestSelectedCalendarEventDelete,
    addSelectedCalendarEventToSelectionSet,
  } = useCalendarEventSelectionSet({
    view,
    activeView,
    activeLayout,
    visibleCalendarEvents,
    activeSelectedItemId,
    activeSelectedDateKey,
    selectedItemId,
    eventsEditable,
    eventsRefreshRange,
    eventsUpsertEvents,
    eventsRemoveEvent,
    eventsMarkStale,
    floatingDetailRef,
    setFloatingDetail,
    setSelectedItemId,
    setSelectedDay,
    setSelectedDateKey,
    closeEventEditor,
    shakeFloatingEditor,
    agendaRailRef,
  });

  const deadlineQuickActionOptions = {
    enabled: open && view === "events" && deadlineOverlayVisible,
    layout: activeLayout,
    actions: deadlineActions,
    onEditTask: (task: FloatingEditorItem, options: { dateKey?: string | null } = {}) => {
      if (activeLayout.stacked) {
        const dateKey = options.dateKey || task.due_date || activeSelectedDateKey;
        const parsed = parseYmd(dateKey);
        if (parsed) {
          setSelectedDay(parsed.day);
          setSelectedDateKey(dateKey);
        }
        setSelectedItemId(getDeadlineSelectionId(task, dateKey as never));
        setDeadlineEditor({ mode: "edit", taskId: String(task.id) });
        setDeadlineDraftPreview(null);
        setFloatingDetail(null);
        return;
      }
      openFloatingDeadlineEdit(task, options);
    },
    onDeleted: (taskId: string | number) => {
      handleFloatingDeadlineDeleted(taskId);
    },
  };
  const deadlineQuickActions = useDeadlineQuickActions(deadlineQuickActionOptions as unknown as UseDeadlineQuickActionsOptions);

  const handleViewChange = useCallback((nextView: string) => {
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty && nextView !== view) {
      shakeFloatingEditor();
      return;
    }
    if (nextView && nextView !== view) {
      setFloatingDetail(null);
    }
    onViewChange?.(nextView);
  }, [floatingDetailRef, onViewChange, setFloatingDetail, shakeFloatingEditor, view]);

  const billsAvailable = !!billsRangeData?.ensureRange;
  const availableCalendarViews = useMemo(
    () => (billsAvailable ? ["events", "bills"] : ["events"]),
    [billsAvailable],
  );
  const cycleView = useCallback((reverse = false) => {
    const next = nextCalendarView({ current: view, views: availableCalendarViews, reverse });
    if (next && next !== view) handleViewChange(next);
  }, [view, availableCalendarViews, handleViewChange]);

  function focusDeadlineTask(task: FloatingEditorItem | null | undefined) {
    if (task?.due_date) focusDateKey(task.due_date);
    const itemId = getDeadlineSelectionId(task);
    setSelectedItemId(itemId != null ? String(itemId) : null);
    setDeadlineEditor(null);
    setDeadlineDraftPreview(null);
  }

  // Active selection (explicit user action: click, mini-calendar, etc.) always wins.
  // Passive sync (agenda hover) is gated by the agenda sync policy (D-CAL-11): it is
  // skipped while the suppression window is open or a grid-anchored detail owns the
  // selection. Both entry points (onAgendaSelectDate / onAgendaHoverDate) below share
  // this implementation.
  function applyAgendaDateSelection(dateKey: string, { passive = false }: { passive?: boolean } = {}) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (passive && shouldIgnorePassiveAgendaSync(current)) return;
    if (current?.open && (current.mode === "edit" || current.mode === "create")) {
      if (passive) return;
      if (current.dirty) {
        shakeFloatingEditor();
        return;
      }
      if (current.view === "events") eventEditor.closeEditor?.();
      if (current.detailKind === "deadline") {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
      }
    } else if (!passive) {
      closeEventEditor();
    }
    if (!passive) setFloatingDetail(null);
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    setSelectedItemId(null);
    if (!passive) {
      setAgendaEntryScrollReleased(true);
      agendaSelectionAnchorRef.current = null;
      clearCalendarEventSelectionSet();
    }
  }

  // Explicit agenda date action (click / keyboard / mini-calendar).
  const onAgendaSelectDate = (dateKey: string) => applyAgendaDateSelection(dateKey);
  // Passive agenda hover follow.
  const onAgendaHoverDate = (dateKey: string) => applyAgendaDateSelection(dateKey, { passive: true });

  // Stable identity for the agenda passive-date-change handler so the prop
  // groups handed to the (memoizable) agenda rail do not churn every controller
  // render. sync.onAgendaScroll / onAgendaHoverDate are recreated each render, so
  // a latest-ref keeps the callback identity fixed while always invoking the
  // current closures. Behavior-preserving — same two calls, same order.
  const agendaPassiveDateChangeImplRef = useRef<((dateKey: string) => void) | null>(null);
  agendaPassiveDateChangeImplRef.current = (dateKey: string) => {
    sync.onAgendaScroll(dateKey);
    onAgendaHoverDate(dateKey);
  };
  const handleAgendaPassiveDateChange = useCallback((dateKey: string) => {
    agendaPassiveDateChangeImplRef.current?.(dateKey);
  }, []);

  function selectAgendaEvent({ event, item, dateKey, anchorElement, sourceCellElement, anchorKind, detailKind, preserveEventSelection = false }: {
    event?: FloatingEditorItem | null;
    item?: FloatingEditorItem | null;
    dateKey: string;
    anchorElement?: HTMLElement | null;
    sourceCellElement?: HTMLElement | null;
    anchorKind?: string;
    detailKind?: string | null;
    preserveEventSelection?: boolean;
  }) {
    const selectedItem = item || event;
    if (!selectedItem) return;
    suppressAgendaPassiveSync();
    const parsed = parseYmd(dateKey);
    if (!parsed) return;
    const current = floatingDetailRef.current;
    if (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty) {
      shakeFloatingEditor();
      return;
    }
    closeEventEditor();
    if (!preserveEventSelection) clearCalendarEventSelectionSet();
    setAgendaEntryScrollReleased(true);
    setSelectedDay(parsed.day);
    setSelectedDateKey(dateKey);
    const itemId = activeView.getItemId ? activeView.getItemId(selectedItem) : selectedItem.id;
    setSelectedItemId(itemId != null ? String(itemId) : null);
    agendaSelectionAnchorRef.current = {
      itemId: itemId != null ? String(itemId) : null,
      dateKey,
      anchorKind: anchorKind || "agenda-row",
    };
    openFloatingDetail({
      mode: "detail",
      view,
      detailKind: detailKind || null,
      itemId,
      dateKey,
      day: parsed.day,
      anchorElement,
      sourceCellElement,
      anchorKind: anchorKind || "agenda-row",
      itemsSnapshot: [selectedItem],
    });
  }

  useEffect(() => {
    setAgendaEntryScrollReleased(false);
  }, [agendaEntryTargetDateKey, openRequestId, view]);

  useEffect(() => {
    if (open) return;
    setAgendaScrollCommand(null);
  }, [open]);

  const scrollAgendaToDate = useCallback((dateKey: string) => {
    agendaSelectionAnchorRef.current = null;
    requestAgendaScroll({ type: "date", dateKey });
  }, [requestAgendaScroll]);

  const scrollAgendaToEvent = useCallback((itemId: string | number, dateKey: string) => {
    agendaSelectionAnchorRef.current = null;
    requestAgendaScroll({ type: "event", itemId, dateKey });
  }, [requestAgendaScroll]);

  function activateMiniCalendarDate(dateKey: string) {
    const parsed = parseYmd(dateKey);
    if (!parsed) return false;
    if (isEditorDirty()) { shakeFloatingEditor(); return false; }
    if (parsed.year !== viewYear || parsed.month !== viewMonth) {
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
    }
    onAgendaSelectDate(dateKey);
    scrollAgendaToDate(dateKey);
    return true;
  }

  function createMiniCalendarEvent(dateKey: string) {
    if (!activateMiniCalendarDate(dateKey)) return false;
    openFloatingEventCreate(dateKey);
    return true;
  }

  const resolveSelectedAgendaEditAnchor = useCallback((itemId: string | number, dateKey: string | null) => {
    const lastAgendaSelection = agendaSelectionAnchorRef.current;
    if (
      !lastAgendaSelection
      || String(lastAgendaSelection.itemId || "") !== String(itemId || "")
      || lastAgendaSelection.dateKey !== dateKey
      || !String(lastAgendaSelection.anchorKind || "").startsWith("agenda")
    ) {
      return null;
    }
    const anchor = agendaRailRef.current?.getItemAnchor?.(itemId, dateKey);
    if (!anchor) return null;
    return {
      anchorElement: anchor,
      sourceCellElement: anchor,
      anchorKind: lastAgendaSelection.anchorKind,
    };
  }, []);

  useEffect(() => {
    const shouldOpenDeadlineCreate = focusItemId === "new" && (
      view === "events" && forceDeadlineOverlay
    );
    if (!open || !shouldOpenDeadlineCreate || !usesFloatingEditor) return;
    const requestKey = `${openRequestId}:${focusDate || ""}`;
    if (handledInitialDeadlineCreateRef.current === requestKey) return;
    handledInitialDeadlineCreateRef.current = requestKey;
    window.requestAnimationFrame(() => {
      if (!floatingDetailRef.current?.open) {
        openFloatingDeadlineCreate(focusDate || activeSelectedDateKey || todayDateKey, {
          allowSelectionFallback: true,
        });
      }
    });
    // Initial create focus is keyed by the explicit open request, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, focusItemId, openRequestId, focusDate, forceDeadlineOverlay, usesFloatingEditor]);

  const commitSyncSnapshotEffects = useEffectEvent((snapshot: CalendarModalSyncSnapshot | null) => {
    const createDeadlineSeedDate = focusDate
      || snapshot?.nextSelectedDateKey
      || activeSelectedDateKey
      || todayDateKey;
    if (snapshot?.didViewChange) {
      closeEventEditor();
      setDeadlineDraftPreview(null);
      setFloatingDetail(null);
    }
    if (snapshot) {
      setAgendaScrollCommand(null);
    }
    if (snapshot?.resetDeadlineEditor) {
      setFloatingDetail(null);
    }
    if (snapshot?.openCreate && view === "events" && forceDeadlineOverlay) {
      if (usesFloatingEditor) {
        openFloatingDeadlineCreate(createDeadlineSeedDate, {
          allowSelectionFallback: true,
        });
      } else {
        setDeadlineEditor({ mode: "create", seedDate: createDeadlineSeedDate });
      }
    } else if (snapshot?.openCreate && view === "events" && eventEditor.editable) {
      if (usesFloatingEditor) {
        openFloatingEventCreate(focusDate || snapshot.nextSelectedDateKey || null);
      } else {
        openEventCreate();
      }
    } else if (snapshot?.resetDeadlineEditor) {
      setDeadlineEditor(null);
      setDeadlineDraftPreview(null);
    }
    commitSelectionSyncSnapshot(snapshot, { open, view, openRequestId });
  });

  useLayoutEffect(() => {
    commitSyncSnapshotEffects(syncSnapshot);
  }, [syncSnapshot, open, view, openRequestId]);

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

  useLayoutEffect(() => {
    if (!open || view !== "bills" || !activeSelectedItemId || !activeSelectedDateKey) return;
    const currentLocation = findItemLocation(
      activeView,
      computed,
      activeSelectedItemId,
      activeSelectedDateKey,
    );
    if (currentLocation?.dateKey === activeSelectedDateKey) return;
    const nextLocation = findItemLocation(activeView, computed, activeSelectedItemId);
    const parsed = parseYmd(nextLocation?.dateKey);
    if (!nextLocation || !parsed) return;
    setSelectedDateKey(nextLocation.dateKey);
    setSelectedDay(parsed.day);
    setSelectedItemId(String(activeSelectedItemId));
    setFloatingDetail((current) => {
      if (
        !current?.open
        || current.view !== "bills"
        || !itemMatchesViewId(activeView, nextLocation.item, current.itemId)
      ) {
        return current;
      }
      return {
        ...current,
        itemId: String(activeSelectedItemId),
        dateKey: nextLocation.dateKey,
        day: parsed.day,
        itemsSnapshot: [nextLocation.item],
      };
    });
  }, [
    activeSelectedDateKey,
    activeSelectedItemId,
    activeView,
    computed,
    open,
    setFloatingDetail,
    setSelectedDateKey,
    setSelectedDay,
    setSelectedItemId,
    view,
  ]);

  const shellViewData = viewData;

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

  useCalendarModalHotkeys({
    open,
    canGoPrev,
    currentMonth,
    currentYear,
    todayDate,
    view,
    viewYear,
    viewMonth,
    closeEventEditor,
    eventEditor,
    deadlineEditor,
    setDeadlineEditor,
    setDeadlineDraftPreview,
    selectedItemId,
    selectedDay,
    selectedDateKey,
    activeView,
    itemsByDay,
    itemsByDate: (computed.itemsByDate || {}) as Record<string, FloatingEditorItem[]>,
    setSuppressFocusRing,
    floatingDetail,
    floatingDetailRef,
    setFloatingDetail,
    handleViewChange,
    cycleView,
    usesFloatingEditor,
    cancelFloatingEditor,
    flipFloatingDetailSide,
    shakeFloatingEditor,
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    requestAgendaScroll,
    resolveSelectedAgendaEditAnchor,
    openFloatingEventEdit,
    openFloatingDeadlineEdit,
    openFloatingEventCreate,
    openFloatingDeadlineCreate,
    toggleEventOverlay,
    deadlineOverlayVisible,
    toggleDeadlineOverlay,
    toggleCompletedDeadlineOverlay,
    setDeadlineOverlayVisible: setDeadlineOverlayVisiblePersisted,
    navigateMonthRef: monthNavigation.navigateMonthRef,
    onCopySelectedEvent: copySelectedCalendarEvent,
    onPasteCopiedEvent: pasteCopiedCalendarEvent,
    onDeleteSelectedEvents: requestSelectedCalendarEventDelete,
    onBeginEventSelectionSetFromSelected: addSelectedCalendarEventToSelectionSet,
    openCalendarSearch: calendarSearch.openSearch,
    cancelCalendarSearch: calendarSearch.cancelSearch,
  });

  const domainEnsureRange = "ensureRange" in viewData ? viewData.ensureRange : undefined;
  const domainRevision = viewData?.revision;
  useEffect(() => {
    if (!open || view === "events" || !domainEnsureRange) return;
    // Bills expand into one date-keyed map shared across every mounted month
    // (active ± 2), so they must be fetched for that whole window — not just the
    // active month, which left the outer mounted months blank on scroll. The +1
    // buffer (radius 3 vs the ±2 mount) loads an edge month before it mounts.
    // Deadlines keep their per-month cache + prefetch and fetch the active grid.
    const { start, end } = view === "bills"
      ? getMultiMonthGridRange(fetchYear, fetchMonth, BILLS_FETCH_MONTH_RADIUS)
      : getVisibleGridRange(fetchYear, fetchMonth);
    const rangePromise = (domainEnsureRange as (start: string, end: string) => Promise<unknown>)(start, end);
    rangePromise.catch((err: unknown) => {
      if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError") return;
      console.error(`[Calendar] ${view} range fetch failed:`, err);
    });
  }, [domainEnsureRange, domainRevision, open, view, fetchYear, fetchMonth]);

  useEffect(() => {
    const current = floatingDetailRef.current;
    // Deadline-kind panels host the Todoist editor and follow the deadline
    // editor lifecycle, not the event editor's — switching workspaces closes
    // the event editor while the deadline panel must stay up.
    if (!current?.open || current.view !== "events" || current.detailKind === "deadline" || (current.mode !== "edit" && current.mode !== "create")) return;
    if (eventEditor.isEditorOpen) return;
    const id = window.requestAnimationFrame(() => {
      setFloatingDetail((latest) => {
        if (!latest?.open || latest.view !== "events" || latest.detailKind === "deadline" || (latest.mode !== "edit" && latest.mode !== "create")) return latest;
        return latest.mode === "create"
          ? null
          : {
              ...latest,
              mode: "detail",
              editorSessionId: null,
              saveRequestId: null,
              activeSaveRequestId: null,
              dirty: false,
            };
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [eventEditor.isEditorOpen, floatingDetailRef, setFloatingDetail]);

  const isMobile = useIsMobile();

  // Mobile-only jump-to-today: re-tapping the active Calendar nav tab bumps
  // jumpTodayRequestId, which we consume here to run the same overlay-preserving
  // reset the in-agenda Events/Bills re-tap uses (scroll agenda to today +
  // recenter the focused month). Desktop never bumps it, so this is inert there.
  const handledJumpTodayRef = useRef(jumpTodayRequestId);
  useEffect(() => {
    if (jumpTodayRequestId === handledJumpTodayRef.current) return;
    handledJumpTodayRef.current = jumpTodayRequestId;
    if (isMobile) sync.navigateToToday();
  }, [jumpTodayRequestId, isMobile, sync]);

  if (!open) return null;

  const shellProps = buildCalendarModalShellProps({
    refs: { panelRef, scrollRef, agendaRailRef, contextRailRef },
    viewState: { view, viewYear, viewMonth, currentYear, currentMonth, todayDate, suppressFocusRing },
    data: { activeView, viewData: shellViewData, weatherData, isMonthCached: eventsHasMonth, getMonthEvents: eventsGetEvents, getMonthDeadlines: deadlinesRangeData?.getMonthData || null, eventsRange: eventsData || null, deadlinesRange: deadlinesRangeData || null, dataRevision: eventsCacheStamp, getMonthBills: billsRangeData?.getMonthData || null, billsRange: billsRangeData || null, billsDataRevision: billsRangeData?.revision ?? 0 },
    viewModel,
    selection: { activeSelectedDay, activeSelectedDateKey, setSelectedDay, setSelectedDateKey, setSelectedItemId, setViewDate },
    editors: {
      eventEditor: {
        ...eventEditor,
        eventOverlay: view === "events"
          ? {
              enabled: eventOverlayVisible,
              onToggle: toggleEventOverlay,
            }
          : null,
        deadlineOverlay: view === "events"
          ? {
              enabled: deadlineOverlayVisible,
              showCompleted: completedDeadlineOverlayVisible,
              readiness: planningReadiness,
              lateDeadlinesReady: !!lateDeadlineOverlayData,
              onToggle: toggleDeadlineOverlay,
              onToggleCompleted: deadlineOverlayVisible ? toggleCompletedDeadlineOverlay : undefined,
              onApplyLateDeadlines: deadlineOverlay?.onApplyLateDeadlines,
            }
          : null,
      },
      deadlineEditor,
      setDeadlineEditor,
      setDeadlineDraftPreview,
    },
    quickActions: { eventQuickActions, deadlineQuickActions },
    agenda: {
      agendaScrollCommand,
      agendaEntryTargetDateKey: effectiveAgendaEntryTargetDateKey,
      onAgendaPassiveDateChange: handleAgendaPassiveDateChange,
      onAgendaDateAction: onAgendaSelectDate,
      onMiniCalendarDateAction: activateMiniCalendarDate,
      onMiniCalendarDateCreate: createMiniCalendarEvent,
      onAgendaEventAction: selectAgendaEvent,
      scrollAgendaToDate,
      scrollAgendaToEvent,
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
  } as unknown as BuildCalendarModalShellPropsInput);

  return (
    <Suspense fallback={null}>{isMobile ? <CalendarMobileAgenda {...shellProps} /> : <CalendarModalShell {...shellProps} />}</Suspense>
  );
}
