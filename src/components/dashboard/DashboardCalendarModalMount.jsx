/* eslint-disable react-refresh/only-export-components */
// Exports both the component (default) and a shared `importCalendar` factory so
// DashboardShell can warm the chunk and the lazy() mount below reuse one dynamic
// import — the const-arrow export trips Fast Refresh, hence the file-level
// disable (matching the convention in src/components/calendar/views/*).
import { lazy, Suspense, useMemo } from "react";
import { makeCalendarBillsData } from "./calendarBillsData";
import { useUtilityPayLinks } from "@/hooks/useUtilityPayLinks";

export const importCalendar = () => import("../calendar/CalendarModal");
const CalendarModal = lazy(importCalendar);

function deadlineDataForCalendarModal(deadlines, isLoading) {
  return {
    upcoming: Array.isArray(deadlines?.upcoming) ? deadlines.upcoming : [],
    stats: deadlines?.stats || null,
    syncHealth: deadlines?.syncHealth || null,
    isLoading,
  };
}

export default function DashboardCalendarModalMount({
  calendarOpenRequestId,
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
  const payLinksByScheduleId = useUtilityPayLinks();
  const billsDataWithLinks = useMemo(
    () => ({ ...(calendarBillsData || makeCalendarBillsData(liveData)), payLinksByScheduleId }),
    [calendarBillsData, liveData, payLinksByScheduleId],
  );
  const seededDeadlines = calendarDeadlines ?? liveData?.liveDeadlines ?? {};

  return (
    <Suspense fallback={null}>
      <CalendarModal
        open={true}
        openRequestId={calendarOpenRequestId}
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
        billsData={billsDataWithLinks}
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
