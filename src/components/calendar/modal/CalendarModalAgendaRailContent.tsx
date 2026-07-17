import { forwardRef } from "react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import BillsAgendaRail from "../views/bills/BillsAgendaRail.tsx";
import EventsAgendaRail from "../views/events/EventsAgendaRail.tsx";

type LegacyAgendaRail = ForwardRefExoticComponent<Record<string, unknown> & RefAttributes<unknown>>;
const BillsAgendaRailCompat = BillsAgendaRail as unknown as LegacyAgendaRail;
const EventsAgendaRailCompat = EventsAgendaRail as unknown as LegacyAgendaRail;

export interface CalendarModalAgendaRailContentProps {
  view: string;
  viewYear?: number;
  viewMonth?: number;
  viewData?: {
    events?: unknown[];
    deadlineOverlay?: unknown;
    planningReadiness?: { state?: unknown };
    isLoading?: boolean;
    agendaEntryReady?: boolean;
  } | null;
  weatherData?: unknown;
  computed?: unknown;
  selectedDateKey?: string | null;
  selectedItemId?: unknown;
  scrollCommand?: unknown;
  entryScrollTargetDateKey?: string | null;
  currentYear?: number;
  currentMonth?: number;
  todayDate?: number;
  monthNavigation?: { canGoPrev?: boolean; navigateMonth?: (offset: number) => void } | null;
  eventQuickActions?: unknown;
  deadlineQuickActions?: unknown;
  floatingEditorDirty?: boolean;
  onDirtyBlocked?: () => void;
  onPassiveDateChange?: (...args: unknown[]) => void;
  onDateAction?: (...args: unknown[]) => void;
  miniCalendarActions?: { onDateAction?: (...args: unknown[]) => void; onDateCreate?: (...args: unknown[]) => void } | null;
  onEventAction?: (...args: unknown[]) => void;
  getMonthEvents?: ((year: number, month: number) => unknown) | null;
  eventsRange?: unknown;
  deadlinesRange?: unknown;
  dataRevision?: number;
  getMonthBills?: ((year: number, month: number) => unknown) | null;
  billsRange?: unknown;
  billsDataRevision?: number;
  hideMiniCalendar?: boolean;
  mobileAgenda?: boolean;
  onFilteredSelectedDeadlineHidden?: () => void;
}

const CalendarModalAgendaRailContent = forwardRef<unknown, CalendarModalAgendaRailContentProps>(function CalendarModalAgendaRailContent({
  view,
  viewYear,
  viewMonth,
  viewData,
  weatherData,
  computed,
  selectedDateKey,
  selectedItemId,
  scrollCommand,
  entryScrollTargetDateKey,
  currentYear,
  currentMonth,
  todayDate,
  monthNavigation = null,
  eventQuickActions,
  floatingEditorDirty,
  onDirtyBlocked,
  onPassiveDateChange,
  onDateAction,
  miniCalendarActions = null,
  onEventAction,
  getMonthEvents = null,
  eventsRange = null,
  deadlinesRange = null,
  dataRevision = 0,
  getMonthBills = null,
  billsRange = null,
  billsDataRevision = 0,
  hideMiniCalendar = false,
  mobileAgenda = false,
}, ref) {
  const miniCalendarNavigation = {
    canGoPrev: monthNavigation?.canGoPrev ?? true,
    onPreviousMonth: monthNavigation?.navigateMonth ? () => monthNavigation.navigateMonth?.(-1) : undefined,
    onNextMonth: monthNavigation?.navigateMonth ? () => monthNavigation.navigateMonth?.(1) : undefined,
  };

  if (view === "events") {
    return (
      <EventsAgendaRailCompat
        ref={ref}
        viewYear={viewYear}
        viewMonth={viewMonth}
        events={viewData?.events || []}
        deadlineOverlay={viewData?.deadlineOverlay || null}
        planningReadinessState={viewData?.planningReadiness?.state}
        weatherData={weatherData}
        isLoading={!!viewData?.isLoading}
        entryScrollReady={viewData?.agendaEntryReady ?? !viewData?.isLoading}
        selectedDateKey={selectedDateKey}
        selectedItemId={selectedItemId}
        scrollCommand={scrollCommand}
        entryScrollTargetDateKey={entryScrollTargetDateKey}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        canGoPrev={miniCalendarNavigation.canGoPrev}
        onPreviousMonth={miniCalendarNavigation.onPreviousMonth}
        onNextMonth={miniCalendarNavigation.onNextMonth}
        eventQuickActions={eventQuickActions}
        floatingEditorDirty={floatingEditorDirty}
        onDirtyBlocked={onDirtyBlocked}
        onPassiveDateChange={onPassiveDateChange}
        onDateAction={onDateAction}
        onMiniCalendarDateAction={miniCalendarActions?.onDateAction}
        onMiniCalendarDateCreate={miniCalendarActions?.onDateCreate}
        onEventAction={onEventAction}
        getMonthEvents={getMonthEvents}
        eventsRange={eventsRange}
        deadlinesRange={deadlinesRange}
        dataRevision={dataRevision}
        hideMiniCalendar={hideMiniCalendar}
        mobileAgenda={mobileAgenda}
      />
    );
  }

  if (view === "bills") {
    return (
      <BillsAgendaRailCompat
        ref={ref}
        viewYear={viewYear}
        viewMonth={viewMonth}
        computed={computed}
        selectedDateKey={selectedDateKey}
        selectedItemId={selectedItemId}
        scrollCommand={scrollCommand}
        entryScrollTargetDateKey={entryScrollTargetDateKey}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        canGoPrev={miniCalendarNavigation.canGoPrev}
        onPreviousMonth={miniCalendarNavigation.onPreviousMonth}
        onNextMonth={miniCalendarNavigation.onNextMonth}
        onPassiveDateChange={onPassiveDateChange}
        onDateAction={onDateAction}
        onMiniCalendarDateAction={miniCalendarActions?.onDateAction}
        onMiniCalendarDateCreate={miniCalendarActions?.onDateCreate}
        onBillAction={onEventAction}
        getMonthBills={getMonthBills}
        billsRange={billsRange}
        dataRevision={billsDataRevision}
        hideMiniCalendar={hideMiniCalendar}
        mobileAgenda={mobileAgenda}
      />
    );
  }

  return null;
});

export default CalendarModalAgendaRailContent;
