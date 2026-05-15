import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal today agenda behavior", () => {
  it("dims past event days more than future days without dimming today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
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
                title: "Past review",
                startMs: new Date("2026-04-10T17:00:00.000Z").getTime(),
                endMs: new Date("2026-04-10T18:00:00.000Z").getTime(),
                allDay: false,
                color: "#4285f4",
              },
            ]),
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      expect(screen.getByTestId("calendar-cell-10").getAttribute("data-past-tone")).toBe("items");
      expect(screen.getByTestId("calendar-cell-15").getAttribute("data-past-tone")).toBe("empty");
      expect(screen.getByTestId("calendar-cell-20").getAttribute("data-past-tone")).toBe("none");
      expect(screen.getByTestId("calendar-cell-24").getAttribute("data-past-tone")).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps today's empty selection when clicking the selected day again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      const { rerender } = render(wrapWithDashboard(
        <CalendarModal
          open={false}
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      await act(async () => {
        rerender(wrapWithDashboard(
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
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-cell-date-header-2026-04-20")).toBeTruthy();

      const todayCell = screen.getByTestId("calendar-cell-20");
      expect(within(todayCell).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();

      const agendaRail = screen.getByTestId("events-agenda-rail");
      expect(within(agendaRail).getByText("No Events")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

      fireEvent.click(todayCell);

      expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects the grid date header without scrolling the agenda rail", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-22"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Work",
              startMs: new Date("2026-04-22T11:15:00.000Z").getTime(),
              endMs: new Date("2026-04-22T15:00:00.000Z").getTime(),
              allDay: false,
              color: "#cba6da",
              writable: true,
            },
            {
              id: "event-2",
              title: "Poster deadline",
              startMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#f9e2af",
            },
            {
              id: "event-3",
              title: "Assignment block",
              startMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T20:30:00.000Z").getTime(),
              allDay: false,
              color: "#f38ba8",
            },
            {
              id: "event-4",
              title: "Late workshop",
              startMs: new Date("2026-04-22T23:00:00.000Z").getTime(),
              endMs: new Date("2026-04-23T00:00:00.000Z").getTime(),
              allDay: false,
              color: "#89b4fa",
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = await screen.findByTestId("events-agenda-rail");
    const initialRailContent = getLatestRailContent();
    const rows = within(agendaRail).getAllByTestId("calendar-agenda-event-row");

    fireEvent.click(rows[3]);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBeTruthy();
      expect(within(screen.getByTestId("calendar-modal-rail")).getAllByText("Late workshop").length).toBeGreaterThan(0);
    });

    agendaRail.scrollTop = 180;
    fireEvent.click(screen.getByTestId("calendar-cell-date-header-2026-04-22"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
      expect(screen.getByTestId("calendar-cell-22").getAttribute("aria-selected")).toBe("true");
      expect(getLatestRailContent()).toBe(initialRailContent);
      expect(agendaRail.scrollTop).toBe(180);
    });
  });

  it("focuses today's day when pressing t", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-10"
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      fireEvent.keyDown(document, { key: "t" });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(within(screen.getByTestId("calendar-mini-calendar"))
        .getByRole("button", { name: /Monday, April 20, today, selected/i })
        .getAttribute("data-date-fill")).toBe("today-selected");
      expect(screen.getByTestId("calendar-cell-date-header-2026-04-20")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lands the agenda rail on today's date header when opened without a focus date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
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

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const firstHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-01']");
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-20']");
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
      firstHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
      todayHeader.getBoundingClientRect = () => ({ top: 620, bottom: 654, left: 0, right: 280, width: 280, height: 34 });

      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 620,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls the agenda rail to today when pressing t from an earlier date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-10"
          eventsData={{
            getEvents: () => ([
              {
                id: "event-today",
                title: "Today planning",
                startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
                endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
                allDay: false,
                color: "#89b4fa",
              },
            ]),
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const todayRow = within(agendaRail).getByTestId("calendar-agenda-event-row");
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-20']");
      const todayContent = todayRow.parentElement;
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
      todayRow.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 });
      todayContent.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 });
      todayHeader.getBoundingClientRect = () => ({ top: 420, bottom: 454, left: 0, right: 280, width: 280, height: 34 });

      fireEvent.keyDown(document, { key: "t" });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: expect.any(Number),
      }));
      expect(scrollTo.mock.calls.some(([command]) => command?.top > 0)).toBe(true);
      expect(agendaRail.scrollTop).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls the visible events agenda to today even while adjacent month data is loading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-10"
          eventsData={{
            getEvents: (year, month) => (
              year === 2026 && month === 3 ? [
                {
                  id: "event-today",
                  title: "Today planning",
                  startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
                  endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
                  allDay: false,
                  color: "#89b4fa",
                },
              ] : []
            ),
            isMonthLoading: (year, month) => year === 2026 && month === 4,
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const todayRow = within(agendaRail).getByTestId("calendar-agenda-event-row");
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-04-20']");
      const todayContent = todayRow.parentElement;
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
      todayRow.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 });
      todayContent.getBoundingClientRect = () => ({ top: 464, bottom: 508, left: 0, right: 280, width: 280, height: 44 });
      todayHeader.getBoundingClientRect = () => ({ top: 420, bottom: 454, left: 0, right: 280, width: 280, height: 34 });

      fireEvent.keyDown(document, { key: "t" });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo.mock.calls.some(([command]) => command?.top > 0)).toBe(true);
      expect(agendaRail.scrollTop).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls from day one to today's agenda header when pressing t", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-05-01"
          eventsData={{
            getEvents: () => ([
              {
                id: "event-one",
                title: "Month start",
                startMs: new Date("2026-05-01T17:00:00.000Z").getTime(),
                endMs: new Date("2026-05-01T18:00:00.000Z").getTime(),
                allDay: false,
                color: "#89b4fa",
              },
              {
                id: "event-today",
                title: "Today planning",
                startMs: new Date("2026-05-04T17:00:00.000Z").getTime(),
                endMs: new Date("2026-05-04T18:00:00.000Z").getTime(),
                allDay: false,
                color: "#f9e2af",
              },
            ]),
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = screen.getByTestId("events-agenda-rail");
      const todayRow = within(agendaRail).getAllByTestId("calendar-agenda-event-row")[1];
      const todayContent = todayRow.parentElement;
      const todayHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-05-04']");
      const scrollTo = vi.fn();
      agendaRail.scrollTop = 0;
      agendaRail.scrollTo = scrollTo;
      agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 260, left: 0, right: 280, width: 280, height: 260 });
      todayContent.getBoundingClientRect = () => ({ top: 654, bottom: 698, left: 0, right: 280, width: 280, height: 44 });
      todayHeader.getBoundingClientRect = () => ({ top: 620, bottom: 654, left: 0, right: 280, width: 280, height: 34 });

      expect(screen.getByTestId("calendar-cell-1").getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(document, { key: "t" });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByTestId("calendar-cell-4").getAttribute("aria-selected")).toBe("true");
      expect(scrollTo.mock.calls.some(([command]) => command?.top > 0)).toBe(true);
      expect(agendaRail.scrollTop).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
