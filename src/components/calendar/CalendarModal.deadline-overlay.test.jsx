import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal deadline overlay behavior", () => {
  it("holds Events first paint until deadline overlay readiness resolves on cold mount", () => {
    window.innerWidth = 1900;
    const ensureDeadlines = vi.fn(() => new Promise(() => {}));

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          ensureRange: vi.fn().mockResolvedValue([]),
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
          isMonthLoading: () => false,
        }}
        billsData={{}}
        deadlinesData={{}}
        deadlinesRangeData={{
          loading: true,
          error: null,
          data: { upcoming: [] },
          dataRange: null,
          ensureRange: ensureDeadlines,
        }}
      />,
    ));

    expect(screen.getByTestId("calendar-grid-skeleton")).toBeTruthy();
    expect(screen.queryByText("Design review")).toBeNull();
  });

  it("shows deadline overlay items in Events by default and persists the header toggle", async () => {
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
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "open" },
          ],
        }}
      />,
    ));

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Project due")).toBeTruthy();

    const eventToggle = screen.getByRole("button", { name: /hide events in events/i });
    const deadlineToggle = screen.getByRole("button", { name: /hide deadlines in events/i });
    const completedToggle = screen.getByRole("button", { name: /hide completed deadlines/i });
    expect(eventToggle.getAttribute("title")).toBeNull();
    expect(deadlineToggle.getAttribute("title")).toBeNull();
    expect(completedToggle.getAttribute("title")).toBeNull();
    expect(eventToggle.parentElement?.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(deadlineToggle.parentElement?.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(completedToggle.parentElement?.getAttribute("data-slot")).toBe("tooltip-trigger");

    fireEvent.click(deadlineToggle);

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Project due")).toBeNull();
    });
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");
  });

  it("opens deadline create from Shift+C in Events and forces the deadline overlay on", async () => {
    window.innerWidth = 1900;
    window.localStorage.setItem("calendar:eventsDeadlineOverlay", "false");

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
        deadlinesData={{ upcoming: [] }}
      />,
    ));

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("true");
    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 23, 2026");
  });

  it("opens a dashboard-focused deadline in Events with the deadline overlay forced on", async () => {
    window.innerWidth = 1900;
    window.localStorage.setItem("calendar:eventsDeadlineOverlay", "false");
    window.localStorage.setItem("calendar:eventsCompletedDeadlines", "false");
    const onViewChange = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="events"
        onViewChange={onViewChange}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        focusOpenDetail
        forceDeadlineOverlay
        forceCompletedDeadlineOverlay
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "complete" },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");
    expect(window.localStorage.getItem("calendar:eventsCompletedDeadlines")).toBe("false");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("renders seeded deadline overlay data before the range refresh resolves", () => {
    window.innerWidth = 1900;
    const ensureDeadlines = vi.fn(() => new Promise(() => {}));

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          ensureRange: vi.fn().mockResolvedValue([]),
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{}}
        deadlinesRangeData={{
          loading: true,
          error: null,
          data: {
            upcoming: [
              { id: "todo-seeded", title: "Seeded task", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
          ensureRange: ensureDeadlines,
        }}
      />,
    ));

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Seeded task")).toBeTruthy();
  });

  it("replaces dashboard deadline overlay seeds when the matching range payload arrives", async () => {
    window.innerWidth = 1900;
    const ensureDeadlines = vi.fn().mockResolvedValue(null);
    const eventsData = {
      editable: true,
      ensureRange: vi.fn().mockResolvedValue([]),
      getEvents: () => [],
    };
    const seededDeadlines = {
      upcoming: [
        { id: "todo-current", title: "Current dashboard task", due_date: "2026-04-20", source: "todoist", status: "open" },
      ],
    };
    const rangeDeadlines = {
      upcoming: [
        { id: "todo-range", title: "Range task", due_date: "2026-04-20", source: "todoist", status: "open" },
      ],
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={eventsData}
        billsData={{}}
        deadlinesData={seededDeadlines}
        deadlinesRangeData={{
          loading: true,
          error: null,
          data: null,
          dataRange: null,
          ensureRange: ensureDeadlines,
        }}
      />,
    ));

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Current dashboard task")).toBeTruthy();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={eventsData}
        billsData={{}}
        deadlinesData={seededDeadlines}
        deadlinesRangeData={{
          loading: false,
          error: null,
          data: rangeDeadlines,
          dataRange: { start: "2026-03-29", end: "2026-05-02" },
          ensureRange: ensureDeadlines,
          revision: 1,
        }}
      />,
    ));

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).getByText("Range task")).toBeTruthy();
    });
    expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Current dashboard task")).toBeNull();
  });

  it("uses the Events header toggle, D, Shift+D, and Shift+E for planning-layer preferences", async () => {
    window.innerWidth = 1900;

    const renderEventsModal = () => render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => [
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
          ],
        }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "Open task", due_date: "2026-04-20", source: "todoist", status: "open" },
            { id: "todo-2", title: "Done task", due_date: "2026-04-20", source: "todoist", status: "complete" },
          ],
        }}
      />,
    ));

    const { unmount } = renderEventsModal();

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Design review")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Done task")).toBeTruthy();

    const eventToggle = screen.getByRole("button", { name: /hide events in events/i });
    expect(eventToggle.parentElement?.getAttribute("data-slot")).toBe("tooltip-trigger");
    fireEvent.click(eventToggle);
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Design review")).toBeNull();
    });
    expect(screen.getByRole("button", { name: /show events in events/i })).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Open task")).toBeTruthy();
    expect(window.localStorage.getItem("calendar:eventsEventOverlay")).toBeNull();

    fireEvent.keyDown(document, { key: "E", shiftKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).getByText("Design review")).toBeTruthy();
    });
    expect(window.localStorage.getItem("calendar:eventsEventOverlay")).toBeNull();

    fireEvent.keyDown(document, { key: "E", shiftKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Design review")).toBeNull();
    });
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Open task")).toBeTruthy();
    expect(window.localStorage.getItem("calendar:eventsEventOverlay")).toBeNull();

    fireEvent.keyDown(document, { key: "E", shiftKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).getByText("Design review")).toBeTruthy();
    });
    expect(window.localStorage.getItem("calendar:eventsEventOverlay")).toBeNull();

    fireEvent.keyDown(document, { key: "d" });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Done task")).toBeNull();
    });
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Open task")).toBeTruthy();
    expect(window.localStorage.getItem("calendar:eventsCompletedDeadlines")).toBe("false");

    fireEvent.keyDown(document, { key: "D", shiftKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Open task")).toBeNull();
    });
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");

    fireEvent.keyDown(document, { key: "d" });
    expect(window.localStorage.getItem("calendar:eventsCompletedDeadlines")).toBe("false");

    fireEvent.keyDown(document, { key: "E", shiftKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Design review")).toBeNull();
    });

    unmount();
    renderEventsModal();
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Design review")).toBeTruthy();
  });

  it("marks slow deadline overlay loading, degrades at timeout, and applies late data explicitly", async () => {
    vi.useFakeTimers();
    try {
      window.innerWidth = 1900;
      let resolveDeadlines;
      const ensureDeadlines = vi.fn(() => new Promise((resolve) => {
        resolveDeadlines = resolve;
      }));

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          focusDate="2026-04-20"
          eventsData={{
            editable: true,
            ensureRange: vi.fn().mockResolvedValue([]),
            getEvents: () => [],
          }}
          billsData={{}}
          deadlinesData={{ upcoming: [] }}
          deadlinesRangeData={{
            loading: true,
            error: null,
            data: null,
            ensureRange: ensureDeadlines,
          }}
        />,
      ));

      await act(async () => {
        await Promise.resolve();
      });
      expect(ensureDeadlines).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId("events-deadline-overlay-status").textContent).toBe("Deadlines slow");

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId("events-deadline-overlay-status").textContent).toBe("Deadlines delayed");

      await act(async () => {
        resolveDeadlines({
          upcoming: [
            { id: "late", title: "Late deadline", due_date: "2026-04-20", source: "todoist", status: "open" },
          ],
        });
        await Promise.resolve();
      });

      expect(screen.queryByText("Late deadline")).toBeNull();
      fireEvent.click(screen.getByTestId("events-deadline-overlay-apply"));
      expect(within(screen.getByTestId("calendar-cell-20")).getByText("Late deadline")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
