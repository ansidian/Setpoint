import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal agenda scroll and selection behavior", () => {
  it("keeps hotkey edit anchored to the agenda row after canceling its detail", async () => {
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
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
              calendarId: "primary",
              accountId: "gmail-main",
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(await screen.findByTestId("calendar-agenda-event-row", {}, { timeout: 5000 }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("agenda-row");
    });

    fireEvent.keyDown(document, { key: "e" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("agenda-row");
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel editor/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("detail");
    });

    fireEvent.click(screen.getByRole("button", { name: /close floating detail/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    fireEvent.keyDown(document, { key: "e" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("agenda-row");
    });
  });

  it("does not replay a month-grid chip scroll command on the next unfocused open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T16:00:00.000Z"));

    try {
      window.innerWidth = 1900;
      const eventsData = {
        editable: true,
        getEvents: () => ([
          {
            id: "event-1",
            title: "Design review",
            startMs: new Date("2026-05-14T17:00:00.000Z").getTime(),
            endMs: new Date("2026-05-14T18:00:00.000Z").getTime(),
            allDay: false,
            color: "#4285f4",
            writable: true,
            calendarId: "primary",
            accountId: "gmail-main",
          },
        ]),
      };

      const { rerender } = render(wrapWithDashboard(
        <CalendarModal
          open
          openRequestId={1}
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={eventsData}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      fireEvent.click(within(await screen.findByTestId("calendar-cell-14", {}, { timeout: 5000 })).getByTestId("calendar-cell-item-chip"));
      await flushAnimationFrame();

      rerender(wrapWithDashboard(
        <CalendarModal
          open={false}
          openRequestId={1}
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={eventsData}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));
      await act(async () => {
        await Promise.resolve();
      });

      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      const scrollTo = vi.fn();
      HTMLElement.prototype.scrollTo = function scrollToMock(options) {
        scrollTo(options);
      };
      HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
        if (this.getAttribute?.("data-testid") === "events-agenda-rail") {
          return { top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 } as DOMRect;
        }
        if (
          this.getAttribute?.("data-agenda-date-header") === "true"
          && this.getAttribute?.("data-date-key") === "2026-05-11"
        ) {
          return { top: 100, bottom: 134, left: 0, right: 280, width: 280, height: 34 } as DOMRect;
        }
        if (this.getAttribute?.("data-testid") === "calendar-agenda-event-row") {
          return { top: 800, bottom: 844, left: 0, right: 280, width: 280, height: 44 } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
      };

      rerender(wrapWithDashboard(
        <CalendarModal
          open
          openRequestId={2}
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={eventsData}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const rail = await screen.findByTestId("events-agenda-rail");
      rail.scrollTop = 0;

      await flushAnimationFrame();

      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalScrollTo) {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      }

      // test-architecture: allow-boundary-interaction -- Initial agenda positioning is an imperative browser scroll contract; DOM layout state in happy-dom does not change when scrollTo is invoked.
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 100,
        behavior: "auto",
      }));
      // test-architecture: allow-boundary-interaction -- The entry-ready path must avoid the competing item-offset browser scroll; happy-dom cannot expose an unintended scroll through layout state.
      expect(scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({
        top: 756,
      }));
    } finally {
      vi.useRealTimers();
    }
  });


  it("keeps an agenda-anchored floating detail open when the panel receives pointer input", async () => {
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
              title: "Late workshop",
              startMs: new Date("2026-04-22T23:00:00.000Z").getTime(),
              endMs: new Date("2026-04-23T00:00:00.000Z").getTime(),
              allDay: false,
              color: "#89b4fa",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = await screen.findByTestId("events-agenda-rail", {}, { timeout: 5000 });
    agendaRail.scrollTop = 0;
    const rows = within(agendaRail).getAllByTestId("calendar-agenda-event-row");

    fireEvent.click(rows[1]!);
    const panel = await screen.findByRole("dialog", { name: /event/i });
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");

    fireEvent.pointerDown(panel);

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");
  });


  it("releases cold agenda landing before scrolling a grid chip selection into the agenda", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-14T16:00:00.000Z"));
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn(function scrollToMock(this: HTMLElement, options: ScrollToOptions) {
      if (options?.behavior === "auto" && Number.isFinite(options.top)) {
        this.scrollTop = options.top!;
      }
    });

    try {
      HTMLElement.prototype.scrollTo = scrollTo as typeof HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
        if (this.getAttribute?.("data-testid") === "events-agenda-rail") {
          return { top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 } as DOMRect;
        }
        if (
          this.getAttribute?.("data-agenda-date-header") === "true"
          && this.getAttribute?.("data-date-key") === "2026-05-01"
        ) {
          return { top: -120, bottom: -86, left: 0, right: 280, width: 280, height: 34 } as DOMRect;
        }
        if (
          this.getAttribute?.("data-agenda-date-header") === "true"
          && this.getAttribute?.("data-date-key") === "2026-05-14"
        ) {
          return { top: 360, bottom: 394, left: 0, right: 280, width: 280, height: 34 } as DOMRect;
        }
        if (this.getAttribute?.("data-testid") === "calendar-agenda-event-row") {
          return { top: 760, bottom: 804, left: 0, right: 280, width: 280, height: 44 } as DOMRect;
        }
        if (this.querySelector?.("[data-testid='calendar-agenda-event-row']")) {
          return { top: 760, bottom: 804, left: 0, right: 280, width: 280, height: 44 } as DOMRect;
        }
        return originalGetBoundingClientRect.call(this);
      };

      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={{
            getEvents: () => ([
              {
                id: "event-15",
                title: "May 15 workshop",
                startMs: new Date("2026-05-15T20:00:00.000Z").getTime(),
                endMs: new Date("2026-05-15T21:00:00.000Z").getTime(),
                allDay: false,
                color: "#89b4fa",
                writable: true,
              },
            ]),
          }}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const agendaRail = await screen.findByTestId("events-agenda-rail", {}, { timeout: 5000 });
      agendaRail.scrollTop = 0;
      await flushAnimationFrame();

      // test-architecture: allow-boundary-interaction -- Agenda initialization owns an imperative browser scroll command whose requested top and behavior are not reflected by happy-dom.
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 360,
        behavior: "auto",
      }));
      scrollTo.mockClear();

      fireEvent.click(within(screen.getByTestId("calendar-cell-15")).getByTestId("calendar-cell-item-chip"));
      await flushAnimationFrame();
      await flushAnimationFrame();

      // test-architecture: allow-boundary-interaction -- Native scrollTo is a browser-imperative boundary; happy-dom cannot expose the requested smooth-scroll target as resulting layout state.
      const itemScrollCall = scrollTo.mock.calls.find(([options]) => (
        options?.behavior === "smooth" && options.top! > 0
      ));
      expect(itemScrollCall).toBeTruthy();
      // test-architecture: allow-boundary-interaction -- Selecting an item must not replay the initial browser scroll command; the browser mock has no resulting layout state to inspect.
      expect(scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({
        top: 360,
        behavior: "auto",
      }));
      expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("May 15 workshop");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalScrollTo) {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      }
      vi.useRealTimers();
    }
  });


  it("cancels a dirty floating event edit with Escape without passive-selecting the first agenda day", async () => {
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

    fireEvent.click(within(await screen.findByTestId("calendar-cell-20", {}, { timeout: 5000 })).getByTestId("calendar-cell-item-chip"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    });

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Design review revised" },
    });
    fireEvent.keyDown(screen.getByTestId("calendar-event-title"), { key: "Escape", cancelable: true });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("detail");
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
    expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("calendar-cell-1").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("calendar-floating-detail-panel").textContent).toContain("Design review");
  });
});
