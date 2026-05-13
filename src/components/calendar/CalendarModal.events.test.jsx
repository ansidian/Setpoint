import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal event grid behavior", () => {
  it("renders event rows into the month grid when events exist", () => {
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

    expect(screen.getAllByText("Design review").length).toBeGreaterThan(0);
  });

  it("renders adjacent-month event cells and keeps create seeded to the actual selected date", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => ([
            {
              id: "event-may-1",
              title: "May planning",
              startMs: new Date("2026-05-01T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const mayCell = screen.getByTestId("calendar-cell-2026-05-01");
    const marchCell = screen.getByTestId("calendar-cell-2026-03-31");
    expect(mayCell.getAttribute("data-current-month")).toBe("false");
    expect(mayCell.getAttribute("data-boundary-side")).toContain("left");
    expect(mayCell.getAttribute("data-boundary-side")).toContain("top");
    expect(within(marchCell).queryByText("Mar 31")).toBeNull();
    expect(within(marchCell).getByText("31")).toBeTruthy();
    expect(within(mayCell).getByText("May 1")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-2026-05-02")).queryByText("May 2")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-2026-05-02")).getByText("2")).toBeTruthy();
    const boundaryOverlay = screen.getByTestId("calendar-month-boundary-overlay");
    expect(within(boundaryOverlay)
      .getByTestId("calendar-month-boundary-top-2026-05-01-2026-05-02")
      .getAttribute("data-boundary-side")).toBe("top");
    expect(within(boundaryOverlay)
      .getByTestId("calendar-month-boundary-left-2026-05-01-2026-05-01")
      .getAttribute("data-boundary-side")).toBe("left");
    expect(within(mayCell).getByText("May planning")).toBeTruthy();

    fireEvent.click(mayCell);
    fireEvent.click(screen.getByRole("button", { name: /new event on may 1/i }));

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/may 1, 2026/i);
    });
  });

  it("keeps the selected event when clicking its selected day cell again", async () => {
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
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const dayCell = screen.getByTestId("calendar-cell-20");
    fireEvent.click(within(dayCell).getByTestId("calendar-cell-item-chip"));
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");

    fireEvent.click(dayCell);

    expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
  });

  it("updates between empty-day selections without remounting the empty rail", async () => {
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
              startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = await screen.findByTestId("events-agenda-rail");
    const initialRailContent = getLatestRailContent();
    expect(within(agendaRail).getByText("No Events")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

    fireEvent.click(screen.getByTestId("calendar-cell-22"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-cell-date-header-2026-04-22")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
      expect(getLatestRailContent()).toBe(initialRailContent);
      expect(screen.getAllByTestId("calendar-rail-content")).toHaveLength(1);
    });
  });

  it.each([
    {
      view: "bills",
      expectedRailTestId: "bills-agenda-rail",
      expectedEmptyText: "No Bills",
      billsData: {},
      deadlinesData: {},
    },
    {
      view: "deadlines",
      expectedRailTestId: "deadlines-agenda-rail",
      expectedEmptyText: "No Deadlines",
      billsData: {},
      deadlinesData: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
    },
  ])("renders the selected-empty-day agenda treatment for $view", async ({
    view,
    expectedRailTestId,
    expectedEmptyText,
    billsData,
    deadlinesData,
  }) => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view={view}
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={billsData}
        deadlinesData={deadlinesData}
      />,
    ));

    const agendaRail = await screen.findByTestId(expectedRailTestId);
    expect(within(agendaRail).getByText(expectedEmptyText)).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-cell-frame")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.queryByTestId("calendar-selected-empty-rail")).toBeNull();
  });

  it("blocks modal hotkeys while typing in the editor", async () => {
    window.innerWidth = 1900;
    const onClose = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={onClose}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    const title = await screen.findByTestId("calendar-event-title");
    title.focus();

    fireEvent.keyDown(title, { key: "ArrowRight" });
    fireEvent.keyDown(title, { key: "r" });
    fireEvent.keyDown(title, { key: "t" });

    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not restart events range readiness when the events data wrapper is recreated", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue([]);
    const getEvents = vi.fn(() => []);
    const eventsDataForRender = () => ({
      ensureRange,
      getEvents,
      editable: false,
    });

    const renderModal = () => wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        eventsData={eventsDataForRender()}
        billsData={{}}
        deadlinesData={{}}
      />,
    );

    const { rerender } = render(renderModal());
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    });

    rerender(renderModal());
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    });
  });

  it("consumes modal hotkeys without leaving selected items in focus-ring mode", async () => {
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
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const panel = screen.getByTestId("calendar-modal-panel");
    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    chip.focus();

    const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      chip.dispatchEvent(spaceEvent);
    });

    expect(spaceEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(panel.getAttribute("data-calendar-suppress-focus-ring")).toBe("true");
    });

    const strayHotkeyEvent = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(strayHotkeyEvent);
    });

    expect(strayHotkeyEvent.defaultPrevented).toBe(true);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(tabEvent);
    });

    await waitFor(() => {
      expect(panel.hasAttribute("data-calendar-suppress-focus-ring")).toBe(false);
    });
  });

  it("refetches the visible events month when the open modal gets a refreshed eventsData object", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue([]);
    const onEventsVisibleRangeChange = vi.fn();

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          ensureRange,
          getEvents: () => [],
          revision: 0,
        }}
        onEventsVisibleRangeChange={onEventsVisibleRangeChange}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(1);
    });
    expect(onEventsVisibleRangeChange).toHaveBeenCalledWith({ start: "2026-03-29", end: "2026-05-02" });

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          ensureRange,
          getEvents: () => [],
          revision: 1,
        }}
        onEventsVisibleRangeChange={onEventsVisibleRangeChange}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a quiet pending-update indicator for stale event refreshes", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          ensureRange: vi.fn().mockResolvedValue([]),
          getEvents: () => [],
          staleRefreshPending: true,
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const indicator = screen.getByTestId("calendar-pending-update");
    expect(indicator.textContent).toBe("");
    expect(indicator.getAttribute("aria-label")).toBe("Calendar updates pending");
    expect(indicator.querySelector(".calendar-pending-update-icon")).toBeTruthy();
  });
});
