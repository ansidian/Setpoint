import { lazy, Suspense } from "react";
import { makeCalendarBillsData } from "./calendarBillsData";

const CalendarModal = lazy(() => import("../calendar/CalendarModal"));

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
  calendarForceDeadlineOverlay,
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
        forceDeadlineOverlay={calendarForceDeadlineOverlay}
        eventsData={eventsData}
        onEventsVisibleRangeChange={handleCalendarEventsRangeChange}
        weatherData={liveData.liveWeather || briefing?.weather || null}
        billsData={calendarBillsData || makeCalendarBillsData(liveData)}
        billsRangeData={calendarBillRange}
        deadlinesData={{
          ctm: seededDeadlines?.ctm || { upcoming: [], stats: null },
          todoist: seededDeadlines?.todoist || { upcoming: [], stats: null },
          isLoading: calendarDeadlinesLoading && !calendarDeadlines,
        }}
        deadlinesRangeData={calendarDeadlineRange}
        deadlineActions={calendarDeadlineActions}
      />
    </Suspense>
  );
}
