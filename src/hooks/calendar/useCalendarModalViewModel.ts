import { useMemo, type Dispatch, type SetStateAction } from "react";
import { getMonthData } from "../../components/calendar/calendarDateUtils.ts";
import useCalendarGhostPreview from "../../components/calendar/useCalendarGhostPreview.ts";
import {
  type FloatingDetailKind,
  formatFloatingDetailLabel,
  formatFloatingEditorLabel,
} from "./calendarFloatingDetailModel";

type CalendarViewItem = Record<string, unknown>;

export interface CalendarComputedView {
  itemsByDay?: Record<number, CalendarViewItem[]>;
  itemsByDate?: Record<string, CalendarViewItem[]>;
  totalEvents?: number;
  [key: string]: unknown;
}

export interface CalendarDayState {
  items: CalendarViewItem[];
  activeItems: CalendarViewItem[];
  completedItems: CalendarViewItem[];
  activeCount: number;
  completedCount: number;
  totalCount: number;
}

interface CalendarMonthValue { year: number; month: number }

interface CalendarActiveView {
  compute: (input: { data: unknown; viewYear: number; viewMonth: number; weatherData: unknown }) => CalendarComputedView;
  canNavigateBack?: (input: Record<string, unknown>) => boolean;
  getDayState?: (items: CalendarViewItem[]) => CalendarDayState;
  getItemId?: (item: CalendarViewItem) => string | number | null | undefined;
  matchesItemId?: (item: CalendarViewItem, id: string | number) => boolean;
}

interface CalendarActiveLayout {
  panelWidth?: string;
  viewportMargin: number;
  [key: string]: unknown;
}

interface FloatingDetailValue {
  open?: boolean;
  mode?: string;
  view?: string;
  dateKey?: string | null;
  day?: number | null;
  detailKind?: FloatingDetailKind;
}

export interface CalendarModalViewModelOptions {
  open: boolean;
  view: string;
  viewData?: Record<string, unknown>;
  visibleCalendarEvents: unknown[];
  deadlineOverlay: unknown;
  activeView: CalendarActiveView;
  activeLayout: CalendarActiveLayout;
  currentYear: number;
  currentMonth: number;
  viewYear: number;
  viewMonth: number;
  labelYear?: number | null;
  labelMonthValue?: number | null;
  activeSelectedDay: number | null;
  activeSelectedDateKey: string | null;
  activeSelectedItemId: string | number | null;
  eventEditor: unknown;
  deadlineEditor: unknown;
  deadlineDraftPreview: unknown;
  weatherData: unknown;
  floatingDetail?: FloatingDetailValue | null;
  setViewDate: Dispatch<SetStateAction<CalendarMonthValue>>;
  setFetchAnchor: Dispatch<SetStateAction<CalendarMonthValue>>;
  setLabelMonth: Dispatch<SetStateAction<CalendarMonthValue>>;
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setSelectedDateKey: Dispatch<SetStateAction<string | null>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  manualMonthBrowseKey: number;
}

function buildFallbackDayState(rawItems: unknown): CalendarDayState {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return {
    items,
    activeItems: items,
    completedItems: [],
    activeCount: items.length,
    completedCount: 0,
    totalCount: items.length,
  };
}

export default function useCalendarModalViewModel({
  open,
  view,
  viewData,
  visibleCalendarEvents,
  deadlineOverlay,
  activeView,
  activeLayout,
  currentYear,
  currentMonth,
  viewYear,
  viewMonth,
  labelYear,
  labelMonthValue,
  activeSelectedDay,
  activeSelectedDateKey,
  activeSelectedItemId,
  eventEditor,
  deadlineEditor,
  deadlineDraftPreview,
  weatherData,
  floatingDetail,
  setViewDate,
  setFetchAnchor,
  setLabelMonth,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  manualMonthBrowseKey,
}: CalendarModalViewModelOptions) {
  const headerYear = labelYear ?? viewYear;
  const headerMonth = labelMonthValue ?? viewMonth;
  // The events view's compute reads only data.events and data.deadlineOverlay,
  // both of which the controller already isolates into stable memos
  // (visibleCalendarEvents / deadlineOverlay). Keying the compute memo on those
  // narrow inputs — instead of the whole viewData object whose identity bumps on
  // every planning-status transition (loading/readiness/stale-refresh) — keeps
  // the O(events x days) day-expansion from re-running on pure status churn.
  // Bills' compute reads a different data shape (schedules/payeeMap), so it
  // stays keyed on viewData.
  const isEventsView = view === "events";
  const eventsComputeData = useMemo(
    () => ({ events: visibleCalendarEvents, deadlineOverlay }),
    [visibleCalendarEvents, deadlineOverlay],
  );
  const computeData = isEventsView ? eventsComputeData : viewData;
  const computed = useMemo(
    () => activeView.compute({ data: computeData, viewYear, viewMonth, weatherData }),
    [activeView, computeData, viewYear, viewMonth, weatherData],
  );
  const itemsByDay = useMemo(() => computed.itemsByDay || {}, [computed.itemsByDay]);
  const ghostPreview = useCalendarGhostPreview({
    open,
    view,
    viewData,
    computed,
    eventEditor,
    deadlineEditor,
    deadlineDraftPreview,
    viewYear,
    viewMonth,
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    setSelectedDay,
    setSelectedDateKey,
    setSelectedItemId,
    manualMonthBrowseKey,
  });

  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const trailingEmpty = 42 - (firstDay + daysInMonth);
  const canGoPrev = activeView.canNavigateBack
    ? activeView.canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, data: viewData, computed })
    : !isCurrentMonth;

  const selectedDayRawItems = activeSelectedDay != null
    ? (computed.itemsByDate?.[activeSelectedDateKey!] ?? itemsByDay[activeSelectedDay] ?? [])
    : [];
  const selectedDayState = activeSelectedDay != null
    ? (activeView.getDayState?.(selectedDayRawItems) ?? buildFallbackDayState(selectedDayRawItems))
    : buildFallbackDayState([]);
  const selectedItems = activeView.getDayState ? selectedDayState : selectedDayState.items;
  const effectiveSelectedItemId = (() => {
    if (activeSelectedDay == null || selectedDayState.totalCount === 0) return null;
    if (activeSelectedItemId == null) return null;
    if (!activeView.getItemId) return activeSelectedItemId;

    const pool = Array.isArray(selectedItems)
      ? selectedItems
      : selectedDayState.items || [];
    const resolveItemId = activeView.getItemId;
    const hasSelectedItem = pool.some((item) => (
      activeView.matchesItemId?.(item, activeSelectedItemId)
      || String(resolveItemId(item)) === String(activeSelectedItemId)
    ));
    return hasSelectedItem ? String(activeSelectedItemId) : null;
  })();
  const hasSelectedDay = activeSelectedDay != null;
  const showDeadlineEditor = view === "events" && !!deadlineEditor;
  const showEventsLoading = view === "events" && viewData?.isLoading && (computed?.totalEvents || 0) === 0;
  const showGridSkeleton = showEventsLoading;
  const showDetail = showDeadlineEditor || (hasSelectedDay && selectedDayState.totalCount > 0);
  const showEmptySelection = hasSelectedDay && selectedDayState.totalCount === 0 && !showDeadlineEditor;
  const floatingDetailLabel = floatingDetail?.open
    ? (floatingDetail.mode === "edit" || floatingDetail.mode === "create"
        ? formatFloatingEditorLabel(
            floatingDetail.mode,
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
            floatingDetail.detailKind || null,
          )
        : formatFloatingDetailLabel(
            floatingDetail.view || view,
            floatingDetail.dateKey || activeSelectedDateKey,
            viewYear,
            viewMonth,
            floatingDetail.day || activeSelectedDay,
            floatingDetail.detailKind || null,
          ))
    : "";
  const layout = activeLayout;
  const panelWidth = layout.panelWidth || `calc(100vw - ${layout.viewportMargin * 2}px)`;
  const monthName = new Date(headerYear, headerMonth).toLocaleDateString("en-US", { month: "long" });

  return {
    buildFallbackDayState,
    canGoPrev,
    computed,
    daysInMonth,
    effectiveSelectedItemId,
    firstDay,
    floatingDetailLabel,
    ghostPreview,
    itemsByDay,
    layout,
    monthName,
    monthYear: String(headerYear),
    panelWidth,
    pendingUpdate: false,
    selectedDayState,
    selectedItems,
    showDetail,
    showEmptySelection,
    showGridSkeleton,
    trailingEmpty,
  };
}
