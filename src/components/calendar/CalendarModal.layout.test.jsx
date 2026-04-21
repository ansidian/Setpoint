import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import CalendarModal from "./CalendarModal.jsx";

const mockGetCalendarSources = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  getCalendarPlaceSuggestions: vi.fn(),
  getCalendarPlaceDetails: vi.fn(),
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getTodoistProjects: vi.fn().mockResolvedValue([]),
  getTodoistLabels: vi.fn().mockResolvedValue([]),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  mockGetCalendarSources.mockResolvedValue({
    accounts: [
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [{ id: "primary", summary: "Personal", writable: true, primary: true }],
      },
    ],
  });
});

function wrapWithDashboard(node) {
  return (
    <DashboardProvider
      briefing={{ emails: { accounts: [] }, ctm: { upcoming: [] }, todoist: { upcoming: [] } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      {node}
    </DashboardProvider>
  );
}

function renderCalendarModalAtWidth(viewportWidth) {
  window.innerWidth = viewportWidth;

  return render(wrapWithDashboard(
    <CalendarModal
      open
      onClose={() => {}}
      view="events"
      onViewChange={() => {}}
      eventsData={{
        getEvents: () => [],
      }}
      billsData={{}}
      deadlinesData={{}}
    />,
  ));
}

describe("CalendarModal responsive layout", () => {
  it("uses the wide desktop rail layout at 1900px", () => {
    renderCalendarModalAtWidth(1900);

    const panel = screen.getByTestId("calendar-modal-panel");
    const body = screen.getByTestId("calendar-modal-body");
    const rail = screen.getByTestId("calendar-modal-rail");

    expect(panel).toBeTruthy();
    expect(panel.style.width).toContain("calc(100vw - 80px)");
    expect(panel.style.maxWidth).toBe("1560px");
    expect(body.style.gridTemplateColumns).toContain("420px");
    expect(rail.style.position).toBe("sticky");
  });

  it("stacks the layout and disables sticky rail at 1240px", () => {
    renderCalendarModalAtWidth(1240);

    const body = screen.getByTestId("calendar-modal-body");
    const rail = screen.getByTestId("calendar-modal-rail");

    expect(body.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(rail.style.position).toBe("relative");
  });

  it("reflows when the viewport resizes after mount", () => {
    renderCalendarModalAtWidth(1900);

    const body = screen.getByTestId("calendar-modal-body");
    const rail = screen.getByTestId("calendar-modal-rail");
    const panel = screen.getByTestId("calendar-modal-panel");

    expect(body.style.gridTemplateColumns).toContain("420px");
    expect(rail.style.position).toBe("sticky");
    expect(panel.style.width).toContain("calc(100vw - 80px)");

    act(() => {
      window.innerWidth = 1240;
      window.dispatchEvent(new Event("resize"));
    });

    expect(body.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(rail.style.position).toBe("relative");
    expect(panel.style.width).toContain("calc(100vw - 48px)");
    expect(panel.style.maxWidth).toBe("1180px");
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

    expect(screen.getByTestId("calendar-events-grid-skeleton")).toBeTruthy();
    expect(screen.getByTestId("calendar-events-rail-skeleton")).toBeTruthy();
  });

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

  it("uses cancel as the only top-level exit action in the event editor", async () => {
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

      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a focused deadline day and item when the modal opens into deadlines", () => {
    window.innerWidth = 1900;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open={false}
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: {
            upcoming: [
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
            ],
          },
        }}
      />,
    ));

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: {
            upcoming: [
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
            ],
          },
        }}
      />,
    ));

    expect(screen.getByText("Monday, April 20")).toBeTruthy();
    expect(screen.getAllByText("Project due").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeTruthy();
  });

  it("falls back to a completed deadline when a day has no active items", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: {
            upcoming: [
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
            ],
          },
        }}
      />,
    ));

    expect(screen.getAllByText("Project due").length).toBeGreaterThan(0);
    expect(screen.getByTestId("timeline-detail-section-toggle-completed-deadlines")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
  });

  it("allows selecting empty days and shows a date-specific empty rail", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    expect(await screen.findByText("Monday, April 20")).toBeTruthy();
    expect(screen.getByText(/no events on this day yet/i)).toBeTruthy();
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

      expect(screen.getByText("Monday, April 20")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the create event form from c and preserves the selected day seed", async () => {
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

  it("refetches the visible events month when the open modal gets a refreshed eventsData object", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue([]);

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
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(1);
    });

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
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(2);
    });
  });

  it("switches the selected deadline in-place when a different row is clicked", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
              { id: "todo-2", title: "Second task", due_date: "2026-04-20", due_time: "11:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            ],
          },
        }}
      />,
    ));

    expect(screen.getAllByText("First task").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("timeline-detail-row")[1]);
    expect(screen.getAllByText("Second task").length).toBeGreaterThan(0);
  });

  it("opens a blank inline Todoist editor from the deadlines header", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            ],
          },
        }}
      />,
    ));

    fireEvent.click(screen.getByRole("button", { name: /new todoist/i }));
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByText("Pick a due date and time")).toBeTruthy();
  });

  it("opens a blank inline Todoist editor from c in deadlines view", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            ],
          },
        }}
      />,
    ));

    fireEvent.keyDown(document, { key: "c" });

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByText("Pick a due date and time")).toBeTruthy();
  });

  it("opens the inline Todoist editor from the selected deadline detail", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            ],
          },
        }}
      />,
    ));

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByDisplayValue("First task")).toBeTruthy();
  });
});
