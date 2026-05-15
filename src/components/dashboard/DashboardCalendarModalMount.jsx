import { lazy, Suspense } from "react";
import { makeCalendarBillsData } from "./calendarBillsData";

const CalendarModal = lazy(() => import("../calendar/CalendarModal"));

function deadlineDataForCalendarModal(deadlines, isLoading) {
  return {
    upcoming: Array.isArray(deadlines?.upcoming) ? deadlines.upcoming : [],
    stats: deadlines?.stats || null,
    syncHealth: deadlines?.syncHealth || null,
    isLoading,
  };
}

export default function DashboardCalendarModalMount({
  isMobile,
  calendarMounted,
  calendarOpen,
  calendarOpenRequestId,
  dismissCalendar,
  calendarView,
  changeCalendarView,
  calendarFocus,
  calendarFocusItemId,
  calendarFocusOpenDetail,
  calendarForceOverlays,
  eventsData,
  handleCalendarEventsRangeChange,
  liveData,
  briefing,
  calendarBillsData,
  calendarBillRange,
  calendarDeadlines,
  calendarDeadlinesLoading,
  calendarDeadlineRange,
  calendarDeadlineActions,
}) {
  if (isMobile || !calendarMounted) return null;
  const seededDeadlines = calendarDeadlines ?? liveData?.liveDeadlines ?? {};

  return (
    <Suspense fallback={null}>
      <CalendarModal
        open={calendarOpen}
        openRequestId={calendarOpenRequestId}
        onClose={dismissCalendar}
        view={calendarView}
        onViewChange={changeCalendarView}
        focusDate={calendarFocus}
        focusItemId={calendarFocusItemId}
        focusOpenDetail={calendarFocusOpenDetail}
        forceEventOverlay={!!calendarForceOverlays?.events}
        forceDeadlineOverlay={!!calendarForceOverlays?.deadlines}
        forceCompletedDeadlineOverlay={!!calendarForceOverlays?.completedDeadlines}
        eventsData={eventsData}
        onEventsVisibleRangeChange={handleCalendarEventsRangeChange}
        weatherData={liveData.liveWeather || briefing?.weather || null}
        billsData={calendarBillsData || makeCalendarBillsData(liveData)}
        billsRangeData={calendarBillRange}
        deadlinesData={deadlineDataForCalendarModal(
          seededDeadlines,
          calendarDeadlinesLoading && !calendarDeadlines,
        )}
        deadlinesRangeData={calendarDeadlineRange}
        deadlineActions={calendarDeadlineActions}
      />
    </Suspense>
  );
}
