import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useUtilityPayLinks", () => ({
  useUtilityPayLinks: () => ({}),
}));

vi.mock("../calendar/CalendarModal", () => ({
  default: function CalendarModalMock({ deadlinesData, billsData }) {
    return (
      <div
        data-testid="calendar-modal"
        data-deadline-title={deadlinesData?.upcoming?.[0]?.title || ""}
        data-bill-id={billsData?.schedules?.[0]?.id || ""}
        data-bill-schedule-id={billsData?.schedules?.[0]?.scheduleId || ""}
        data-bill-paid={String(!!billsData?.schedules?.[0]?.paid)}
      />
    );
  },
}));

const { default: DashboardCalendarModalMount } = await import("./DashboardCalendarModalMount.jsx");

afterEach(() => {
  cleanup();
});

describe("DashboardCalendarModalMount", () => {
  it("seeds modal deadline data from current dashboard deadlines before calendar deadlines load", async () => {
    render(
      <DashboardCalendarModalMount
        isMobile={false}
        calendarMounted
        calendarOpen
        calendarOpenRequestId={1}
        dismissCalendar={() => {}}
        calendarView="events"
        changeCalendarView={() => {}}
        calendarFocus="2026-04-20"
        calendarFocusItemId={null}
        calendarFocusOpenDetail={false}
        calendarForceDeadlineOverlay
        eventsData={{ getEvents: () => [] }}
        handleCalendarEventsRangeChange={() => {}}
        liveData={{
          liveDeadlines: {
            upcoming: [
              { id: "deadline-current", title: "Current dashboard task", due_date: "2026-04-20" },
            ],
            stats: { incomplete: 1 },
          },
        }}
        briefing={{}}
        calendarBillsData={null}
        calendarBillRange={{}}
        calendarDeadlines={undefined}
        calendarDeadlinesLoading
        calendarDeadlineRange={{}}
        calendarDeadlineActions={{}}
      />,
    );

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.getAttribute("data-deadline-title")).toBe("Current dashboard task");
    });
  });

  it("seeds Bills from mirror occurrence rows without rewriting identity or paid state", async () => {
    render(
      <DashboardCalendarModalMount
        isMobile={false}
        calendarMounted
        calendarOpen
        calendarOpenRequestId={1}
        dismissCalendar={() => {}}
        calendarView="bills"
        changeCalendarView={() => {}}
        calendarFocus="2026-05-10"
        calendarFocusItemId="sched-1:2026-05-10"
        calendarFocusOpenDetail
        calendarForceDeadlineOverlay={false}
        eventsData={{ getEvents: () => [] }}
        handleCalendarEventsRangeChange={() => {}}
        liveData={{
          allSchedules: [
            {
              id: "sched-1:2026-05-10",
              scheduleId: "sched-1",
              name: "Mortgage",
              next_date: "2026-05-10",
              paid: true,
            },
          ],
          payeeMap: {},
          actualBudgetUrl: "https://actual.example.test",
        }}
        briefing={{}}
        calendarBillsData={null}
        calendarBillRange={{}}
        calendarDeadlines={undefined}
        calendarDeadlinesLoading={false}
        calendarDeadlineRange={{}}
        calendarDeadlineActions={{}}
      />,
    );

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.getAttribute("data-bill-id")).toBe("sched-1:2026-05-10");
      expect(modal.getAttribute("data-bill-schedule-id")).toBe("sched-1");
      expect(modal.getAttribute("data-bill-paid")).toBe("true");
    });
  });
});
