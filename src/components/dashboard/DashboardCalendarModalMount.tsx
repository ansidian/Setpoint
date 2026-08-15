/* eslint-disable react-refresh/only-export-components */
// Exports both the component (default) and a shared `importCalendar` factory so
// DashboardShell can warm the chunk and the lazy() mount below reuse one dynamic
// import — the const-arrow export trips Fast Refresh, hence the file-level
// disable (matching the convention in src/components/calendar/views/*).
import { lazy, Suspense, useMemo } from "react";
import { makeCalendarBillsData } from "./calendarBillsData";
import { dashboardCalendarDeadlineData } from "./dashboardCalendarModalModel";
import { useUtilityPayLinks } from "@/hooks/useUtilityPayLinks";
import type { ComponentProps } from "react";
import type { DashboardBriefingProjection, CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { DashboardCalendarBillsData } from "./calendarBillsData";
import type { CalendarView } from "../../../shared/types/calendar";
import type { DashboardCalendarEventsRange } from "./useCalendarWorkspaceState";
import type { ActualBillOccurrence } from "../../../shared/types/actual";
import type { CalendarEventCreateRequest } from "../../hooks/calendar/calendarEventCreateBridge";

export const importCalendar = () => import("../calendar/CalendarModal");
const CalendarModal = lazy(importCalendar);
type CalendarModalProps = ComponentProps<typeof CalendarModal>;
export interface DashboardCalendarModalMountProps {
  [key: string]: unknown;
  calendarOpenRequestId: number;
  calendarEventCreateRequest?: CalendarEventCreateRequest | null;
  calendarJumpTodayRequestId?: number;
  calendarView: CalendarView;
  changeCalendarView: (view: string) => void;
  calendarFocus: string | null;
  calendarFocusItemId: string | null;
  calendarFocusOpenDetail: boolean;
  calendarForceOverlays?: { events: boolean; deadlines: boolean; completedDeadlines: boolean };
  eventsData: CalendarModalProps["eventsData"];
  handleCalendarEventsRangeChange: (range: DashboardCalendarEventsRange | null) => void;
  liveData: Partial<Omit<CurrentDashboardLiveData, "liveDeadlines" | "allSchedules">> & {
    liveDeadlines?: { upcoming?: Array<Record<string, unknown>>; stats?: unknown; syncHealth?: unknown };
    allSchedules?: Array<Partial<ActualBillOccurrence>>;
  };
  briefing: Partial<DashboardBriefingProjection> | null;
  calendarBillsData?: Partial<DashboardCalendarBillsData> | null;
  calendarBillRange: CalendarModalProps["billsRangeData"];
  calendarDeadlines?: {
    upcoming?: readonly unknown[];
    stats?: unknown;
    syncHealth?: unknown;
  } | null;
  calendarDeadlinesLoading: boolean;
  calendarDeadlineRange: CalendarModalProps["deadlinesRangeData"];
  calendarDeadlineActions: CalendarModalProps["deadlineActions"];
}

export default function DashboardCalendarModalMount({
  calendarOpenRequestId,
  calendarEventCreateRequest,
  calendarJumpTodayRequestId,
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
}: DashboardCalendarModalMountProps) {
  const payLinksByScheduleId = useUtilityPayLinks();
  const billsDataWithLinks = useMemo(
    () => ({ ...(calendarBillsData || makeCalendarBillsData(liveData as CurrentDashboardLiveData)), payLinksByScheduleId }),
    [calendarBillsData, liveData, payLinksByScheduleId],
  );
  const seededDeadlines = calendarDeadlines ?? liveData?.liveDeadlines ?? {};

  return (
    <Suspense fallback={null}>
      <CalendarModal
        open={true}
        openRequestId={calendarOpenRequestId}
        eventCreateRequest={calendarEventCreateRequest}
        jumpTodayRequestId={calendarJumpTodayRequestId}
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
        deadlinesData={dashboardCalendarDeadlineData(
          seededDeadlines,
          calendarDeadlinesLoading && !calendarDeadlines,
        )}
        deadlinesRangeData={calendarDeadlineRange}
        deadlineActions={calendarDeadlineActions}
      />
    </Suspense>
  );
}
