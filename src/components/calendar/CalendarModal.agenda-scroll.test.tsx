import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

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

    fireEvent.click(await screen.findByTestId("calendar-agenda-event-row"));

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

      fireEvent.click(within(screen.getByTestId("calendar-cell-14")).getByTestId("calendar-cell-item-chip"));
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

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 100,
        behavior: "auto",
      }));
      expect(scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({
        top: 756,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves detail-list scroll position when selecting another event in the same day", async () => {
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

    agendaRail.scrollTop = 180;
    fireEvent.click(rows[3]!);

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-modal-rail")).getAllByText("Late workshop").length).toBeGreaterThan(0);
      expect(getLatestRailContent()).toBe(initialRailContent);
      expect(agendaRail.scrollTop).toBe(180);
    });
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

    const agendaRail = await screen.findByTestId("events-agenda-rail");
    agendaRail.scrollTop = 0;
    const rows = within(agendaRail).getAllByTestId("calendar-agenda-event-row");

    fireEvent.click(rows[1]!);
    const panel = await screen.findByRole("dialog", { name: /event/i });
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");

    fireEvent.pointerDown(panel);

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");
  });

  it("keeps a grid-chip floating detail open while the agenda rail scrolls to that item", async () => {
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
              id: "event-1",
              title: "Senior Design Expo",
              startMs: new Date("2026-05-01T16:30:00.000Z").getTime(),
              endMs: new Date("2026-05-01T19:00:00.000Z").getTime(),
              allDay: false,
              color: "#cba6da",
              writable: true,
            },
            {
              id: "event-5",
              title: "Cinco de Mayo",
              startMs: new Date("2026-05-05T07:00:00.000Z").getTime(),
              endMs: new Date("2026-05-06T07:00:00.000Z").getTime(),
              allDay: true,
              color: "#f9e2af",
              writable: true,
            },
            {
              id: "event-6",
              title: "Midweek checkpoint",
              startMs: new Date("2026-05-06T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-06T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#89b4fa",
              writable: true,
            },
            {
              id: "event-29",
              title: "Late workshop",
              startMs: new Date("2026-05-29T20:00:00.000Z").getTime(),
              endMs: new Date("2026-05-29T21:00:00.000Z").getTime(),
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

    const may29Cell = screen.getByTestId("calendar-cell-29");
    fireEvent.click(within(may29Cell).getByTestId("calendar-cell-item-chip"));
    const panel = await screen.findByRole("dialog", { name: /event/i });
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");

    const agendaRail = screen.getByTestId("events-agenda-rail");
    const may5Header = within(agendaRail).getByRole("button", { name: /select tuesday, may 5/i });
    const may6Header = within(agendaRail).getByRole("button", { name: /select wednesday, may 6/i });
    agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 } as DOMRect);
    may5Header.getBoundingClientRect = () => ({ top: -48, bottom: -14, left: 0, right: 280, width: 280, height: 34 } as DOMRect);
    may6Header.getBoundingClientRect = () => ({ top: 2, bottom: 36, left: 0, right: 280, width: 280, height: 34 } as DOMRect);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      fireEvent.scroll(agendaRail);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");
    expect(screen.getByTestId("calendar-cell-29").getAttribute("aria-selected")).toBe("true");
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

      const agendaRail = await screen.findByTestId("events-agenda-rail");
      agendaRail.scrollTop = 0;
      await flushAnimationFrame();

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
        top: 360,
        behavior: "auto",
      }));
      scrollTo.mockClear();

      fireEvent.click(within(screen.getByTestId("calendar-cell-15")).getByTestId("calendar-cell-item-chip"));
      await flushAnimationFrame();
      await flushAnimationFrame();

      const itemScrollCall = scrollTo.mock.calls.find(([options]) => (
        options?.behavior === "smooth" && options.top! > 0
      ));
      expect(itemScrollCall).toBeTruthy();
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

  it("switches the selected deadline in-place when a different agenda row is clicked", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            { id: "todo-2", title: "Second task", due_date: "2026-04-20", due_time: "11:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
          ],
        }}
      />,
    ));

    const agendaRail = screen.getByTestId("events-agenda-rail");
    expect(within(agendaRail).getAllByText("First task").length).toBeGreaterThan(0);
    fireEvent.click(within(agendaRail).getAllByTestId("calendar-agenda-deadline-row")[1]!);
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Second task");
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

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));
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
