import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal shell and search layout", () => {
  it("keeps the modal workspace usable across desktop and compact widths", async () => {
    window.innerWidth = 3840;

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

    const panel = screen.getByTestId("calendar-modal-panel");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
    expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();

    await act(async () => {
      window.innerWidth = 1240;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
    });

    await act(async () => {
      window.innerWidth = 1100;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
    });
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
    const skeleton = screen.getByTestId("calendar-grid-skeleton");

    expect(monthGrid).toBeTruthy();
    expect(skeleton).toBeTruthy();
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
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
    });
  });

  it("keeps stacked search usable without overlapping the grid", async () => {
    window.innerWidth = 900;

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
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("stacked-replaces-agenda");
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.queryByTestId("calendar-modal-rail")).toBeNull();
    });
  });
});
