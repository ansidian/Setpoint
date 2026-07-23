import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal shell and search layout", () => {
  it("exposes the seven named weekday column headers", () => {
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

    const weekdayHeaders = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
      .map((name) => screen.getByRole("columnheader", { name }));
    expect(weekdayHeaders).toHaveLength(7);
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
