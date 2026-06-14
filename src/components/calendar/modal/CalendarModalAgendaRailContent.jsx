import { forwardRef } from "react";
import BillsAgendaRail from "../views/bills/BillsAgendaRail.jsx";
import EventsAgendaRail from "../views/events/EventsAgendaRail.jsx";

const CalendarModalAgendaRailContent = forwardRef(function CalendarModalAgendaRailContent({
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
}, ref) {
  const miniCalendarNavigation = {
    canGoPrev: monthNavigation?.canGoPrev ?? true,
    onPreviousMonth: monthNavigation?.navigateMonth ? () => monthNavigation.navigateMonth(-1) : undefined,
    onNextMonth: monthNavigation?.navigateMonth ? () => monthNavigation.navigateMonth(1) : undefined,
  };

  if (view === "events") {
    return (
      <EventsAgendaRail
        ref={ref}
        viewYear={viewYear}
        viewMonth={viewMonth}
        events={viewData?.events || []}
        deadlineOverlay={viewData?.deadlineOverlay || null}
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
      />
    );
  }

  if (view === "bills") {
    return (
      <BillsAgendaRail
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
      />
    );
  }

  return null;
});

export default CalendarModalAgendaRailContent;
