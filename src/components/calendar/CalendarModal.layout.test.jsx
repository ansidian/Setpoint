import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function getLatestRailContent() {
  const railContent = screen.getAllByTestId("calendar-rail-content");
  return railContent[railContent.length - 1];
}

describe("CalendarModal responsive layout", () => {
  it("fills the viewport as a workspace and only stacks at the narrow fallback", async () => {
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

    const panel = screen.getByTestId("calendar-modal-panel");
    const body = screen.getByTestId("calendar-modal-body");
    const rail = screen.getByTestId("calendar-modal-rail");
    const supportBand = screen.getByTestId("calendar-modal-support-band");
    const workspaceColumn = body.firstElementChild;
    const monthGrid = screen.getByTestId("calendar-grid-month");

    expect(panel.style.width).toBe("calc(100vw - 32px)");
    expect(panel.style.height).toBe("calc(100vh - 32px)");
    expect(body.style.gridTemplateColumns).toContain("320px");
    expect(rail.style.position).toBe("sticky");
    expect(supportBand.getAttribute("data-support-mode")).toBe("overview");
    expect(workspaceColumn?.style.gridTemplateRows).toBe("minmax(0, 1fr) auto");
    expect(workspaceColumn?.style.gap).toBe("0px");
    expect(monthGrid.style.gridTemplateRows).toBe("repeat(5, minmax(0, 1fr))");
    expect(supportBand.style.height).toBe("126px");
    expect(supportBand.querySelector("[data-calendar-local-scroll='true']")).toBeNull();
    expect(body.firstElementChild?.contains(supportBand)).toBe(true);
    expect(body.lastElementChild).toBe(rail);

    await act(async () => {
      window.innerWidth = 1240;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(panel.style.width).toBe("calc(100vw - 48px)");
      expect(panel.style.height).toBe("calc(100vh - 48px)");
      expect(body.style.gridTemplateColumns).toContain("272px");
      expect(rail.style.position).toBe("sticky");
      expect(workspaceColumn?.style.gridTemplateRows).toBe("minmax(0, 1fr) auto");
      expect(supportBand.style.height).toBe("auto");
      expect(supportBand.style.minHeight).toBe("106px");
    });

    await act(async () => {
      window.innerWidth = 1100;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(panel.style.width).toBe("calc(100vw - 32px)");
      expect(panel.style.height).toBe("calc(100vh - 32px)");
      expect(body.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
      expect(rail.style.position).toBe("relative");
      expect(workspaceColumn?.style.gridTemplateRows).toBe("auto auto");
      expect(body.firstElementChild?.contains(supportBand)).toBe(true);
      expect(body.lastElementChild).toBe(rail);
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

    expect(monthGrid.style.gridTemplateRows).toBe("repeat(5, minmax(0, 1fr))");
    expect(skeleton.style.gridTemplateRows).toBe("repeat(5, minmax(0, 1fr))");
    expect(skeleton).toBeTruthy();
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

  it("keeps the selected event when clicking its selected day cell again", () => {
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
    expect(screen.getByTestId("calendar-selected-event-title").textContent).toContain("Design review");

    fireEvent.click(dayCell);

    expect(screen.getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("detail");
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
    expect(screen.getByTestId("deadline-status-indicator-deadline-1").getAttribute("aria-label")).toBe("Incomplete");
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
    expect(screen.getByTestId("deadline-status-indicator-deadline-1").getAttribute("aria-label")).toBe("Complete");
  });

  it("keeps the deadlines rail in summary mode while live deadline data is still loading", () => {
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
          isLoading: true,
          ctm: { upcoming: [] },
          todoist: { upcoming: [] },
        }}
      />,
    ));

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("summary");
  });

  it("does not render completed-only deadlines into the month cell preview", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-21"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: {
            upcoming: [
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
            ],
          },
          todoist: { upcoming: [] },
        }}
      />,
    ));

    const quietChip = screen.getByText("Project due").closest("button");
    expect(quietChip).toBeTruthy();
    expect(quietChip?.style.textDecoration).toContain("line-through");
  });

  it("uses the event-style font treatment for the selected deadline title", () => {
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
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
            ],
          },
          todoist: { upcoming: [] },
        }}
      />,
    ));

    expect(screen.getByTestId("calendar-selected-deadline-title").className).not.toContain("ea-display");
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
    const emptyRail = screen.getByTestId("calendar-selected-empty-rail");
    expect(emptyRail).toBeTruthy();
    expect(within(emptyRail).getByText("Open day")).toBeTruthy();
    expect(within(emptyRail).getByText(/nothing is scheduled here/i)).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-cell-frame")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-empty-cell-placeholder")).toBeTruthy();
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

      expect(screen.getByText("Monday, April 20")).toBeTruthy();

      const todayCell = screen.getByTestId("calendar-cell-20");
      expect(within(todayCell).getByTestId("calendar-selected-empty-cell-placeholder")).toBeTruthy();

      const emptyRailFrame = screen.getByTestId("calendar-selected-empty-rail-frame");
      expect(emptyRailFrame.style.overflow).toBe("hidden");
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");

      fireEvent.click(todayCell);

      expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-empty-cell-placeholder")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the no-selection overview rail non-scrollable", () => {
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

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("summary");
    expect(screen.getByTestId("calendar-overview-rail-frame").style.overflow).toBe("hidden");
  });

  it.each([
    {
      view: "events",
      eventsData: {
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
      },
      billsData: {},
      deadlinesData: {},
      expectedText: "Design review",
    },
    {
      view: "bills",
      eventsData: { getEvents: () => [] },
      billsData: {
        schedules: [
          {
            id: "bill-1",
            name: "Rent",
            next_date: "2026-04-20",
            paid: false,
            type: "bill",
            conditions: [
              { field: "amount", value: { num1: 180000 } },
              { field: "payee", value: "payee-1" },
            ],
          },
        ],
        payeeMap: {
          "payee-1": "Landlord",
        },
      },
      deadlinesData: {},
      expectedText: "Rent",
    },
    {
      view: "deadlines",
      eventsData: { getEvents: () => [] },
      billsData: {},
      deadlinesData: {
        ctm: {
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        },
      },
      expectedText: "Project due",
    },
  ])("renders a locally scrollable detail rail for $view", async ({
    view,
    eventsData,
    billsData,
    deadlinesData,
    expectedText,
  }) => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view={view}
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={eventsData}
        billsData={billsData}
        deadlinesData={deadlinesData}
      />,
    ));

    const detailRail = await screen.findByTestId("timeline-detail-rail");
    const detailSections = await screen.findByTestId("timeline-detail-sections");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("detail");
    expect(within(detailRail).getAllByText(expectedText).length).toBeGreaterThan(0);
    expect(detailRail.style.overflow).toBe("hidden");
    expect(detailSections.getAttribute("data-calendar-local-scroll")).toBe("true");
    expect(detailSections.style.overflowY).toBe("auto");
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

    const detailSections = await screen.findByTestId("timeline-detail-sections");
    const initialRailContent = getLatestRailContent();
    const rows = within(detailSections).getAllByTestId("timeline-detail-row");

    detailSections.scrollTop = 180;
    fireEvent.click(rows[3]);

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-modal-rail")).getAllByText("Late workshop").length).toBeGreaterThan(0);
      expect(getLatestRailContent()).toBe(initialRailContent);
      expect(detailSections.scrollTop).toBe(180);
    });
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

    expect(await screen.findByText("Monday, April 20")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");

    fireEvent.click(screen.getByTestId("calendar-cell-22"));

    await waitFor(() => {
      expect(screen.getByText("Wednesday, April 22")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");
      expect(screen.getAllByTestId("calendar-rail-content")).toHaveLength(1);
    });
  });

  it.each([
    {
      view: "bills",
      expectedTitle: "Clear billing day",
      expectedRailCopy: /no bills land on this date/i,
      billsData: {},
      deadlinesData: {},
    },
    {
      view: "deadlines",
      expectedTitle: "Open deadline day",
      expectedRailCopy: /no deadlines are due on this date/i,
      billsData: {},
      deadlinesData: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
    },
  ])("renders the compact selected-empty-day treatment for $view", async ({
    view,
    expectedTitle,
    expectedRailCopy,
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

    expect(await screen.findByText("Monday, April 20")).toBeTruthy();
    const emptyRail = screen.getByTestId("calendar-selected-empty-rail");
    expect(within(emptyRail).getByText(expectedTitle)).toBeTruthy();
    expect(within(emptyRail).getByText(expectedRailCopy)).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-cell-frame")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-empty-cell-placeholder")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("empty");
    expect(screen.getByTestId("calendar-selected-empty-rail-frame").style.overflow).toBe("hidden");
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

  it("widens the context stage and collapses the support band when entering editor mode", async () => {
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

      const body = screen.getByTestId("calendar-modal-body");
      const supportBand = screen.getByTestId("calendar-modal-support-band");

      fireEvent.keyDown(document, { key: "c" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-editor-rail").getAttribute("data-editor-layout")).toBe("desktop-staged");
      expect(screen.getByTestId("calendar-event-editor-detail-layout").getAttribute("data-layout-mode")).toBe("desktop-staged");
      expect(screen.getByTestId("calendar-modal-editor-expanded")).toBeTruthy();
      expect(body.style.gridTemplateColumns).toContain("620px");
      expect(supportBand.getAttribute("data-support-mode")).toBe("editor");
      expect(supportBand.style.height).toBe("60px");
      expect(supportBand.querySelector("[data-calendar-local-scroll='true']")).toBeNull();
      expect(supportBand.textContent).not.toMatch(/draft rhythm/i);
      expect(supportBand.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(supportBand.textContent).not.toMatch(/choose a calendar/i);
      expect(supportBand.textContent).not.toMatch(/ready for details/i);
      expect(screen.getByTestId("calendar-cell-23")).toBeTruthy();
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

  it("closes the inline Todoist editor from its local exit action without closing the modal", async () => {
    window.innerWidth = 1900;
    const onClose = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={onClose}
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
    const inlineEditor = await screen.findByTestId("todoist-inline-editor");
    fireEvent.click(within(inlineEditor).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
