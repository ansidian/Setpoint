import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal agenda rail state behavior", () => {
  it("closes a completed deadline floating detail when completed agenda rows are hidden", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
          ],
        }}
      />,
    ));

    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide completed deadlines/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(within(screen.getByTestId("events-agenda-rail")).queryByText("Project due")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Project due")).toBeNull();
  });

  it("keeps the no-selection rail in agenda mode", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("events-agenda-rail").getAttribute("data-calendar-local-scroll")).toBe("true");
  });

  it("keeps the Mini Calendar fixed above the Events agenda local scroller", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const miniCalendar = await screen.findByTestId("calendar-mini-calendar");
    const agendaRail = screen.getByTestId("events-agenda-rail");
    const contextRail = screen.getByTestId("calendar-modal-rail");

    expect(contextRail.contains(miniCalendar)).toBe(true);
    expect(agendaRail.contains(miniCalendar)).toBe(false);
    expect(agendaRail.getAttribute("data-calendar-local-scroll")).toBe("true");
    expect(miniCalendar.compareDocumentPosition(agendaRail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

});
