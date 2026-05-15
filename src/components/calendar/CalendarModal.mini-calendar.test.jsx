import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { flushAnimationFrame, wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

function emptyEventsData(overrides = {}) {
  return {
    editable: true,
    getEvents: () => [],
    ...overrides,
  };
}

function miniDate(name) {
  return within(screen.getByTestId("calendar-mini-calendar")).getByRole("button", { name });
}

describe("CalendarModal Mini Calendar activation", () => {
  it("selects a Mini Calendar date and lands the agenda rail on that date", async () => {
    window.innerWidth = 1900;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = function scrollToMock(options) {
      scrollTo(options);
      this.scrollTop = options.top;
    };
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.getAttribute?.("data-testid") === "events-agenda-rail") {
        return { top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 };
      }
      if (
        this.getAttribute?.("data-agenda-date-header") === "true"
        && this.getAttribute?.("data-date-key") === "2026-05-28"
      ) {
        return { top: 760, bottom: 794, left: 0, right: 280, width: 280, height: 34 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    };

    try {
      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-05-01"
          eventsData={emptyEventsData()}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const calendar = await screen.findByTestId("calendar-mini-calendar");
      fireEvent.click(within(calendar).getByRole("button", { name: /Thursday, May 28/i }));
      await flushAnimationFrame();

      await waitFor(() => {
        expect(miniDate(/Thursday, May 28, selected/i).getAttribute("data-date-fill")).toBe("selected");
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
          top: 760,
          behavior: "auto",
        }));
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalScrollTo) HTMLElement.prototype.scrollTo = originalScrollTo;
      else delete HTMLElement.prototype.scrollTo;
    }
  });

  it("syncs Mini Calendar selection from agenda scrolling before later date activation", async () => {
    window.innerWidth = 1900;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn(function scrollToMock(options) {
      if (Number.isFinite(options?.top)) this.scrollTop = options.top;
    });

    try {
      HTMLElement.prototype.scrollTo = scrollTo;
      HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
        if (this.getAttribute?.("data-testid") === "events-agenda-rail") {
          return { top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 };
        }
        if (this.getAttribute?.("data-date-key") === "2026-05-01") {
          return { top: -420, bottom: -386, left: 0, right: 280, width: 280, height: 34 };
        }
        if (this.getAttribute?.("data-date-key") === "2026-05-04") {
          return { top: -120, bottom: -86, left: 0, right: 280, width: 280, height: 34 };
        }
        if (this.getAttribute?.("data-date-key") === "2026-05-20") {
          return { top: 2, bottom: 36, left: 0, right: 280, width: 280, height: 34 };
        }
        if (this.getAttribute?.("data-date-key") === "2026-05-28") {
          return { top: 760, bottom: 794, left: 0, right: 280, width: 280, height: 34 };
        }
        return originalGetBoundingClientRect.call(this);
      };

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-05-04"
          eventsData={{
            editable: true,
            getEvents: () => [
              {
                id: "event-1",
                title: "Planning block",
                startMs: new Date("2026-05-04T16:00:00.000Z").getTime(),
                endMs: new Date("2026-05-04T17:00:00.000Z").getTime(),
                allDay: false,
                color: "#89b4fa",
                writable: true,
              },
              {
                id: "event-20",
                title: "Review block",
                startMs: new Date("2026-05-20T16:00:00.000Z").getTime(),
                endMs: new Date("2026-05-20T17:00:00.000Z").getTime(),
                allDay: false,
                color: "#a6e3a1",
                writable: true,
              },
            ],
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = await screen.findByTestId("events-agenda-rail");
      await flushAnimationFrame();
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      });
      scrollTo.mockClear();

      fireEvent.wheel(agendaRail, { deltaY: 320 });
      fireEvent.scroll(agendaRail);
      await flushAnimationFrame();

      expect(miniDate(/Wednesday, May 20, selected/i).getAttribute("data-date-fill")).toBe("selected");
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(scrollTo).not.toHaveBeenCalled();

      fireEvent.click(miniDate(/Thursday, May 28/i));
      await flushAnimationFrame();

      await waitFor(() => {
        expect(miniDate(/Thursday, May 28, selected/i).getAttribute("data-date-fill")).toBe("selected");
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
          top: 760,
          behavior: "auto",
        }));
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalScrollTo) HTMLElement.prototype.scrollTo = originalScrollTo;
      else delete HTMLElement.prototype.scrollTo;
    }
  });

  it("activates an adjacent-month Mini Calendar date through the shared month", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-01"
        eventsData={emptyEventsData()}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const calendar = await screen.findByTestId("calendar-mini-calendar");
    fireEvent.click(within(calendar).getByRole("button", { name: /Monday, June 1/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/June\s+2026/i);
      expect(miniDate(/Monday, June 1, selected/i).getAttribute("data-date-fill")).toBe("selected");
    });
  });

  it("double-click creates a calendar event seeded to the Mini Calendar date from Bills", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-05-05"
        eventsData={emptyEventsData()}
        billsData={{ schedules: [] }}
        deadlinesData={{}}
      />,
    ));

    const calendar = await screen.findByTestId("calendar-mini-calendar");
    const date = within(calendar).getByRole("button", { name: /Wednesday, May 20/i });
    fireEvent.click(date);
    fireEvent.doubleClick(date);

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/may 20, 2026/i);
  });

  it("blocks Mini Calendar activation and create when the floating event editor is dirty", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-05"
        eventsData={emptyEventsData()}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.keyDown(document, { key: "c" });
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Hold this draft" },
    });
    await act(async () => {
      await Promise.resolve();
    });

    const date = miniDate(/Wednesday, May 20/i);
    fireEvent.click(date);
    fireEvent.doubleClick(date);
    await flushAnimationFrame();

    expect(miniDate(/Tuesday, May 5, selected/i)).toBeTruthy();
    expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/may 5, 2026/i);
    expect(screen.getByDisplayValue("Hold this draft")).toBeTruthy();
    await waitFor(() => {
      expect(panel.querySelector("[data-calendar-floating-editor-feedback='active']")).toBeTruthy();
    });
  });

  it("ignores wheel input over the Mini Calendar", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-05"
        eventsData={emptyEventsData()}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.wheel(await screen.findByTestId("calendar-mini-calendar"), {
      deltaY: 120,
      deltaMode: 0,
      cancelable: true,
    });

    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
  });
});
