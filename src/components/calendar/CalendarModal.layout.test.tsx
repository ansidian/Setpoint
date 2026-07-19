import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal shell and search layout", () => {
  it("aligns the weekday header with the seven-column calendar grid", () => {
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

    const calendarColumn = screen.getByTestId("calendar-scroll-container").parentElement!;
    const weekdayHeaders = screen.getAllByRole("columnheader");

    expect(weekdayHeaders).toHaveLength(7);
    expect(weekdayHeaders.every((header) => calendarColumn.contains(header))).toBe(true);
    expect(screen.getByTestId("calendar-modal-rail").contains(weekdayHeaders[6]!)).toBe(false);
  });

  it("shows skeleton loaders while the events month is loading", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        eventsData={{
          getEvents: () => [],
          isMonthLoading: () => true,
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const monthGrid = screen.getByTestId("calendar-grid-month");
    const skeletons = screen.getAllByTestId("calendar-grid-skeleton");

    expect(monthGrid).toBeTruthy();
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("calendar-mini-calendar")).toBeTruthy();
    expect(screen.getByTestId("calendar-events-rail-skeleton")).toBeTruthy();
  });

  it("opens the search rail from the header and keeps three desktop columns when space allows", async () => {
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

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("three-rail");
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-mini-calendar")).toBeTruthy();
      expect(screen.getByTestId("calendar-search-input")).toBe(document.activeElement);
    });
  });

  it("lets search replace the agenda rail on constrained layouts", async () => {
    window.innerWidth = 1240;

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

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("search-replaces-agenda");
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.queryByTestId("calendar-modal-rail")).toBeNull();
      expect(screen.queryByTestId("calendar-mini-calendar")).toBeNull();
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
    });
  });

});
