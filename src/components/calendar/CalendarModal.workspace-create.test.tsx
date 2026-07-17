import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, pointerClick, stubRect, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

// These workspace flows wait on multi-step rAF parking cycles (1.5-2.7s each in
// isolation); the global 10s testTimeout flakes under full-suite worker load.
vi.setConfig({ testTimeout: 20000 });

describe("CalendarModal floating event create workspace behavior", () => {
  it("opens the create event form from c and preserves the selected day seed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-23"
          eventsData={{
            editable: true,
            getEvents: () => [],
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      fireEvent.keyDown(document, { key: "c" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/apr 23, 2026/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a staged floating workspace when entering editor mode", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-23"
          eventsData={{
            editable: true,
            getEvents: () => [],
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      fireEvent.keyDown(document, { key: "c" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-editor-rail").getAttribute("data-editor-layout")).toBe("slim-icon");
      expect(screen.queryByTestId("calendar-event-editor-detail-layout")).toBeNull();
      expect(screen.getByTestId("calendar-event-compact-toolbar")).toBeTruthy();
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.queryByTestId("calendar-modal-editor-expanded")).toBeNull();
      expect(screen.getByTestId("calendar-cell-23")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an event create workspace open across chevron month navigation", async () => {
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
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByTestId("calendar-cell-20"));
    fireEvent.click(screen.getByRole("button", { name: /new event on apr 20/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-schedule-trigger"));
    expect(await screen.findByTestId("calendar-compact-schedule-picker")).toBeTruthy();

    const headerNextButton = screen.getAllByRole("button", { name: /next month/i })
      .find((btn) => btn.getAttribute("data-calendar-month-navigation") === "true");
    fireEvent.click(headerNextButton!);

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/Apr 20, 2026/i);
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");

    const headerPrevButton = screen.getAllByRole("button", { name: /previous month/i })
      .find((btn) => btn.getAttribute("data-calendar-month-navigation") === "true");
    fireEvent.click(headerPrevButton!);

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    });
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
  });

  it("returns a clean event create workspace to its anchor without closing it", async () => {
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
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByTestId("calendar-cell-20"));
    fireEvent.click(screen.getByRole("button", { name: /new event on apr 20/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");

    pointerClick(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    });
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
  });

  it("preserves a clean event create workspace when month navigation immediately follows opening it", async () => {
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
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByTestId("calendar-cell-20"));
    const newEventButton = screen.getByRole("button", { name: /new event on apr 20/i });
    const nextMonthButton = screen.getByRole("button", { name: /next month/i });

    await act(async () => {
      fireEvent.click(newEventButton);
      fireEvent.pointerDown(nextMonthButton);
      fireEvent.click(nextMonthButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    });
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
  });

  it("opens a seeded create workspace on a visible trailing day without jumping months", async () => {
    window.innerWidth = 1900;

    const baseProps = {
      open: true,
      onClose: () => {},
      view: "events",
      onViewChange: () => {},
      eventsData: {
        editable: true,
        getEvents: () => [],
      },
      billsData: {},
      deadlinesData: {},
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        focusDate="2026-05-02"
      />,
    ));

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);

    rerender(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={1}
        focusDate="2026-06-01"
        focusItemId="new"
      />,
    ));

    await flushAnimationFrame();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });
    expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/Jun 1, 2026/i);
  });

  it("returns a clean event create workspace anchored to an interior current-month day", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-07"
        eventsData={{
          editable: true,
          getEvents: () => ([
            {
              id: "event-passive-day",
              title: "Morning hold",
              startMs: new Date("2026-05-01T16:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T17:00:00.000Z").getTime(),
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

    fireEvent.click(screen.getByTestId("calendar-cell-7"));
    fireEvent.click(screen.getByRole("button", { name: /new event on may 7/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    pointerClick(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/June\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 950));
    });

    const agendaRail = screen
      .getAllByTestId("events-agenda-rail")
      .find((rail) => rail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-05-07']"));
    expect(agendaRail).toBeTruthy();
    stubRect(agendaRail!, { top: 100, bottom: 500, height: 400 });
    agendaRail!.querySelectorAll<HTMLElement>("[data-agenda-date-header='true']").forEach((header) => {
      stubRect(header, { top: 600, bottom: 624 });
    });
    const passiveHeader = agendaRail!.querySelector<HTMLElement>("[data-agenda-date-header='true'][data-date-key='2026-05-01']");
    expect(passiveHeader).toBeTruthy();
    stubRect(passiveHeader!, {
      top: 90,
      bottom: 114,
    });

    fireEvent.scroll(agendaRail!);
    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
  });

  it("returns a dirty event create workspace without treating month navigation as a close attempt", async () => {
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
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByTestId("calendar-cell-20"));
    fireEvent.click(screen.getByRole("button", { name: /new event on apr 20/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Rough hold" },
    });

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));
    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-floating-detail-panel").querySelector("[data-calendar-floating-editor-feedback='active']")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });
    expect(screen.getByDisplayValue("Rough hold")).toBeTruthy();
  });
});
