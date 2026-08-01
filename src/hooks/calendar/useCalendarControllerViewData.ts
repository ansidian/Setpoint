import { useMemo } from "react";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import { computeCalendarBillsViewData } from "./calendarBillsViewDataModel";
import {
  addMonthOffset,
  dedupeEvents,
  EMPTY_CALENDAR_EVENTS,
  type DeadlineOverlayRecord,
} from "./calendarControllerHelpers";
import {
  computeCalendarEntryReadiness,
  type CalendarEntryPlanningReadiness,
} from "./calendarEntryReadinessModel";

export interface ControllerEventsData {
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

export interface ControllerRangeData<T = unknown> {
  ensureRange?: (start: string, end: string) => Promise<T>;
  getMonthData?: (...args: never[]) => unknown;
  data?: T | null;
  dataRange?: { start: string; end: string } | null;
  revision?: number;
  loading?: boolean;
  error?: unknown;
  [key: string]: unknown;
}

interface CalendarControllerViewDataOptions {
  view: string;
  viewYear: number;
  viewMonth: number;
  eventOverlayVisible: boolean;
  eventsData?: ControllerEventsData | null;
  deadlineOverlayVisible: boolean;
  committedDeadlineOverlayData: DeadlineOverlayRecord<unknown> | null;
  deadlinesRangeData?: ControllerRangeData<unknown> | null;
  planningReadiness: CalendarEntryPlanningReadiness;
  deadlinesData: unknown;
  deadlineOverlay: unknown;
  billsData?: Record<string, unknown>;
  billsRangeData?: ControllerRangeData<Record<string, unknown>> | null;
}

export default function useCalendarControllerViewData({
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
}: CalendarControllerViewDataOptions) {
  const eventsEnsureRange = eventsData?.ensureRange || null;
  const eventsGetEvents = eventsData?.getEvents || null;
  const eventsHasMonth = eventsData?.hasMonth || null;
  const eventsIsMonthLoading = eventsData?.isMonthLoading || null;
  const eventsLoading = !!eventsData?.loading;
  const eventsStaleRefreshPending = !!eventsData?.staleRefreshPending;
  const eventsRevision = eventsData?.revision;
  const eventsCacheStamp = eventsData?.cacheStamp ?? 0;

  const visibleCalendarEvents = useMemo(() => {
    if (view !== "events" || !eventOverlayVisible || !eventsGetEvents) return EMPTY_CALENDAR_EVENTS;
    const prevMonth = addMonthOffset(viewYear, viewMonth, -1);
    const nextMonth = addMonthOffset(viewYear, viewMonth, 1);
    return dedupeEvents([
      ...(eventsGetEvents(prevMonth.year, prevMonth.month) || []),
      ...(eventsGetEvents(viewYear, viewMonth) || []),
      ...(eventsGetEvents(nextMonth.year, nextMonth.month) || []),
    ]);
    // eventsCacheStamp invalidates the ref-backed eventsGetEvents reads.
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

  return { visibleCalendarEvents, viewData };
}
