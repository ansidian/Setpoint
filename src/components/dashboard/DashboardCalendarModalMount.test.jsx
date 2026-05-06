import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../calendar/CalendarModal", () => ({
  default: function CalendarModalMock({ deadlinesData }) {
    return (
      <div
        data-testid="calendar-modal"
        data-deadline-title={deadlinesData?.todoist?.upcoming?.[0]?.title || ""}
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
            ctm: { upcoming: [] },
            todoist: {
              upcoming: [
                { id: "todo-current", title: "Current dashboard task", due_date: "2026-04-20", source: "todoist" },
              ],
            },
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
      expect(screen.getByTestId("calendar-modal").getAttribute("data-deadline-title")).toBe("Current dashboard task");
    });
  });
});
