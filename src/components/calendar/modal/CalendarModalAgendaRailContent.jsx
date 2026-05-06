import { forwardRef } from "react";
import BillsAgendaRail from "../views/bills/BillsAgendaRail.jsx";
import DeadlinesAgendaRail from "../views/deadlines/DeadlinesAgendaRail.jsx";
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
  currentYear,
  currentMonth,
  todayDate,
  eventQuickActions,
  deadlineQuickActions,
  floatingEditorDirty,
  onDirtyBlocked,
  onPassiveDateChange,
  onDateAction,
  onEventAction,
  onFilteredSelectedDeadlineHidden,
  showCompletedDeadlines,
  onShowCompletedDeadlinesChange,
}, ref) {
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
        selectedDateKey={selectedDateKey}
        selectedItemId={selectedItemId}
        scrollCommand={scrollCommand}
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        eventQuickActions={eventQuickActions}
        floatingEditorDirty={floatingEditorDirty}
        onDirtyBlocked={onDirtyBlocked}
        onPassiveDateChange={onPassiveDateChange}
        onDateAction={onDateAction}
        onEventAction={onEventAction}
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
        currentYear={currentYear}
        currentMonth={currentMonth}
        todayDate={todayDate}
        onPassiveDateChange={onPassiveDateChange}
        onDateAction={onDateAction}
        onBillAction={onEventAction}
      />
    );
  }

  return (
    <DeadlinesAgendaRail
      ref={ref}
      viewYear={viewYear}
      viewMonth={viewMonth}
      computed={computed}
      selectedDateKey={selectedDateKey}
      selectedItemId={selectedItemId}
      scrollCommand={scrollCommand}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayDate={todayDate}
      floatingEditorDirty={floatingEditorDirty}
      onDirtyBlocked={onDirtyBlocked}
      onPassiveDateChange={onPassiveDateChange}
      onDateAction={onDateAction}
      onDeadlineAction={onEventAction}
      onFilteredSelectedDeadlineHidden={onFilteredSelectedDeadlineHidden}
      showCompleted={showCompletedDeadlines}
      onShowCompletedChange={onShowCompletedDeadlinesChange}
      deadlineQuickActions={deadlineQuickActions}
    />
  );
});

export default CalendarModalAgendaRailContent;
