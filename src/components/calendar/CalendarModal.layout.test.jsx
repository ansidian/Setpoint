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

function getCurrentMonthGridRows() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.ceil((firstDay + daysInMonth) / 7);
}

describe("CalendarModal responsive layout", () => {
  it("fills the viewport as a workspace and only stacks at the narrow fallback", async () => {
    window.innerWidth = 1900;
    const expectedRows = getCurrentMonthGridRows();

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
    const workspaceColumn = body.firstElementChild;
    const monthGrid = screen.getByTestId("calendar-grid-month");

    expect(panel.style.width).toBe("calc(100vw - 32px)");
    expect(panel.style.height).toBe("calc(100vh - 32px)");
    expect(body.style.gridTemplateColumns).toContain("320px");
    expect(rail.style.position).toBe("sticky");
    expect(workspaceColumn?.style.gridTemplateRows).toBe("minmax(0, 1fr)");
    expect(monthGrid.style.gridTemplateRows).toBe(`repeat(${expectedRows}, minmax(0, 1fr))`);
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
      expect(workspaceColumn?.style.gridTemplateRows).toBe("minmax(0, 1fr)");
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
      expect(workspaceColumn?.style.gridTemplateRows).toBe("auto");
      expect(body.lastElementChild).toBe(rail);
    });
  });

  it("uses an unclamped uhd workspace on 4K-class viewports", () => {
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
    const body = screen.getByTestId("calendar-modal-body");

    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.style.width).toBe("calc(100vw - 64px)");
    expect(panel.style.maxWidth).toBe("");
    expect(panel.style.height).toBe("calc(100vh - 64px)");
    expect(panel.style.maxHeight).toBe("");
    expect(body.style.gridTemplateColumns).toContain("380px");
  });

  it("shows skeleton loaders while the events month is loading", () => {
    window.innerWidth = 1900;
    const expectedRows = getCurrentMonthGridRows();

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

    expect(monthGrid.style.gridTemplateRows).toBe(`repeat(${expectedRows}, minmax(0, 1fr))`);
    expect(skeleton.style.gridTemplateRows).toBe(`repeat(${expectedRows}, minmax(0, 1fr))`);
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
    const mayTopBoundary = within(boundaryOverlay).getByTestId("calendar-month-boundary-top-2026-05-01-2026-05-02");
    expect(mayTopBoundary.style.borderTopLeftRadius).toBe("8px");
    expect(mayTopBoundary.style.background).toBe("rgb(0, 149, 255)");
    expect(mayTopBoundary.style.height).toBe("2px");
    expect(mayTopBoundary.style.gridColumn).toBe("6 / 8");
    expect(mayTopBoundary.style.gridRow).toBe("5");
    const mayLeftBoundary = within(boundaryOverlay).getByTestId("calendar-month-boundary-left-2026-05-01-2026-05-01");
    expect(mayLeftBoundary.style.borderTopLeftRadius).toBe("8px");
    expect(mayLeftBoundary.style.background).toBe("rgb(0, 149, 255)");
    expect(mayLeftBoundary.style.width).toBe("2px");
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

  it("opens a floating selected-event detail from chips and reuses the shell for another chip", async () => {
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
            {
              id: "event-2",
              title: "Budget sync",
              startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T20:00:00.000Z").getTime(),
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

    const dayCell = screen.getByTestId("calendar-cell-20");
    const chips = within(dayCell).getAllByTestId("calendar-cell-item-chip");

    fireEvent.click(chips[0]);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(screen.getAllByTestId("calendar-selected-event-title").some((node) => (
      node.textContent?.includes("Design review")
    ))).toBe(true);

    fireEvent.click(chips[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId("calendar-floating-detail-panel")).toHaveLength(1);
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Budget sync");
    });
  });

  it("keeps the floating detail open when clicking the same selected chip", async () => {
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

    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    fireEvent.click(chip);

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
  });

  it("keeps overflow open while a selected overflow item opens floating detail, then Escape closes detail first", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => Array.from({ length: 5 }, (_, index) => ({
            id: `event-${index + 1}`,
            title: `Overflow event ${index + 1}`,
            startMs: new Date(`2026-04-20T${String(15 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            endMs: new Date(`2026-04-20T${String(16 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            allDay: false,
            color: "#4285f4",
            writable: true,
          })),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const overflowTrigger = await screen.findByTestId("calendar-cell-overflow-trigger-20");
    fireEvent.click(overflowTrigger);
    const popover = await screen.findByTestId("calendar-cell-overflow-popover");
    const overflowItem = within(popover).getAllByTestId("calendar-cell-overflow-item")[0];

    fireEvent.click(overflowItem);

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(screen.getByTestId("calendar-cell-overflow-popover")).toBe(popover);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(overflowItem.textContent?.match(/Overflow event \d/)?.[0] || "Overflow event");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(screen.getByTestId("calendar-modal-panel").getAttribute("data-calendar-suppress-focus-ring")).toBe("true");
    expect(screen.getByTestId("calendar-cell-overflow-popover")).toBe(popover);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
    });
  });

  it("keeps a parked floating detail visible beyond the adjacent month data window", async () => {
    window.innerWidth = 1900;
    const aprilEvent = {
      id: "event-1",
      title: "Design review",
      startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
      allDay: false,
      color: "#4285f4",
      writable: true,
    };
    const juneEvent = {
      id: "event-june-20",
      title: "Unrelated June hold",
      startMs: new Date("2026-06-20T17:00:00.000Z").getTime(),
      endMs: new Date("2026-06-20T18:00:00.000Z").getTime(),
      allDay: false,
      color: "#89b4fa",
      writable: true,
    };

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: (year, month) => {
            if (year === 2026 && month === 3) return [aprilEvent];
            if (year === 2026 && month === 5) return [juneEvent];
            return [];
          },
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/June\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
      expect(within(panel).queryByText("Unrelated June hold")).toBeNull();
    });
  });

  it("does not render floating detail on stacked layouts", async () => {
    window.innerWidth = 1100;

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

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
  });

  it("morphs floating detail into the event editor", async () => {
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
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    });
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
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

      expect(screen.getAllByRole("button", { name: /cancel/i }).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).not.toBe("editor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks calendar close while the floating event editor is dirty", async () => {
    window.innerWidth = 1900;
    const onClose = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={onClose}
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
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    await waitFor(() => {
      expect(panel.querySelector("[data-calendar-floating-editor-feedback='active']")).toBeTruthy();
    });

    fireEvent.click(within(panel).getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
  });

  it("opens E-key event edits anchored with a visible caret", async () => {
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
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    const panel = screen.getByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-floating-detail-caret")).toBeTruthy();
  });

  it("preserves a focused deadline day and item when the modal opens into deadlines", async () => {
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

    const agendaRail = screen.getByTestId("deadlines-agenda-rail");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(within(agendaRail).getAllByText("Project due").length).toBeGreaterThan(0);
    const row = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    expect(row.getAttribute("data-item-id")).toBe("deadline-1");

    fireEvent.click(row);

    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(screen.getAllByRole("button", { name: /mark complete/i }).length).toBeGreaterThan(0);
  });

  it("opens agenda-anchored floating event detail from dashboard item focus", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="event-1"
        focusOpenDetail
        eventsData={{
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
        deadlinesData={{}}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
  });

  it("opens agenda-anchored floating deadline detail from dashboard item focus", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        focusOpenDetail
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

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
  });

  it("falls back to a completed deadline when a day has no active items", async () => {
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

    const agendaRail = screen.getByTestId("deadlines-agenda-rail");
    expect(within(agendaRail).getAllByText("Project due").length).toBeGreaterThan(0);
    const row = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    expect(within(row).getByLabelText("Complete")).toBeTruthy();

    fireEvent.click(row);

    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(within(panel).getAllByText("Complete").length).toBeGreaterThan(0);
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

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("deadlines-agenda-rail")).toBeTruthy();
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

    const quietChip = within(screen.getByTestId("calendar-cell-20")).getByText("Project due").closest("button");
    expect(quietChip).toBeTruthy();
    expect(quietChip?.getAttribute("data-item-id")).toBe("deadline-1");
  });

  it("uses the event-style font treatment for the selected deadline title", async () => {
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

    const row = within(screen.getByTestId("deadlines-agenda-rail")).getByTestId("calendar-agenda-deadline-row");
    fireEvent.click(row);

    expect((await screen.findByTestId("calendar-selected-deadline-title")).className).not.toContain("ea-display");
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
        eventsData={{ editable: true, getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    expect(await screen.findByTestId("calendar-cell-date-header-2026-04-20")).toBeTruthy();
    const agendaRail = screen.getByTestId("events-agenda-rail");
    expect(agendaRail).toBeTruthy();
    expect(within(agendaRail).getByText("No Events")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-selected-cell-frame")).toBeTruthy();
    expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
    expect(screen.queryByRole("button", { name: /create on apr 20/i })).toBeNull();
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
      expect(agendaRail.style.overflowY).toBe("auto");
      expect(within(agendaRail).getByText("No Events")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

      fireEvent.click(todayCell);

      expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
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

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("events-agenda-rail").style.overflowY).toBe("auto");
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
  ])("renders a locally scrollable agenda rail for $view", async ({
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

    const testId = {
      events: "events-agenda-rail",
      bills: "bills-agenda-rail",
      deadlines: "deadlines-agenda-rail",
    }[view];
    const agendaRail = await screen.findByTestId(testId);
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(within(agendaRail).getAllByText(expectedText).length).toBeGreaterThan(0);
    expect(agendaRail.getAttribute("data-calendar-local-scroll")).toBe("true");
    expect(agendaRail.style.overflowY).toBe("auto");
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
    fireEvent.click(rows[3]);

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

    fireEvent.click(rows[1]);
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
    agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    may5Header.getBoundingClientRect = () => ({ top: -48, bottom: -14, left: 0, right: 280, width: 280, height: 34 });
    may6Header.getBoundingClientRect = () => ({ top: 2, bottom: 36, left: 0, right: 280, width: 280, height: 34 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      fireEvent.scroll(agendaRail);
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Late workshop");
    expect(screen.getByTestId("calendar-cell-29").getAttribute("aria-selected")).toBe("true");
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
      expect(screen.getByTestId("calendar-cell-date-header-2026-04-20")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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

  it("remembers a Space-flipped floating detail side only for same-date grid browsing", async () => {
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
              title: "Design review",
              startMs: new Date("2026-05-01T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
            {
              id: "event-2",
              title: "Budget review",
              startMs: new Date("2026-05-01T19:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T20:00:00.000Z").getTime(),
              allDay: false,
              color: "#34a853",
              writable: true,
            },
            {
              id: "event-3",
              title: "Monday planning",
              startMs: new Date("2026-05-04T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-04T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#fbbc04",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const modalPanel = screen.getByTestId("calendar-modal-panel");
    const rail = screen.getByTestId("calendar-modal-rail");
    const fridayCell = screen.getByTestId("calendar-cell-1");
    const mondayCell = screen.getByTestId("calendar-cell-4");
    const fridayChips = within(fridayCell).getAllByTestId("calendar-cell-item-chip");
    const mondayChip = within(mondayCell).getByTestId("calendar-cell-item-chip");
    modalPanel.getBoundingClientRect = () => ({ top: 0, bottom: 720, left: 0, right: 1200, width: 1200, height: 720 });
    rail.getBoundingClientRect = () => ({ top: 60, bottom: 680, left: 900, right: 1180, width: 280, height: 620 });
    fridayCell.getBoundingClientRect = () => ({ top: 180, bottom: 300, left: 620, right: 700, width: 80, height: 120 });
    mondayCell.getBoundingClientRect = () => ({ top: 310, bottom: 390, left: 80, right: 160, width: 80, height: 80 });
    fridayChips[0].getBoundingClientRect = () => ({ top: 200, bottom: 228, left: 640, right: 672, width: 32, height: 28 });
    fridayChips[1].getBoundingClientRect = () => ({ top: 232, bottom: 260, left: 640, right: 672, width: 32, height: 28 });
    mondayChip.getBoundingClientRect = () => ({ top: 330, bottom: 358, left: 100, right: 132, width: 32, height: 28 });

    fireEvent.click(fridayChips[0]);
    const floatingPanel = await screen.findByTestId("calendar-floating-detail-panel");

    const flipEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      fridayChips[0].dispatchEvent(flipEvent);
    });

    expect(flipEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(floatingPanel.getAttribute("data-forced-side")).toMatch(/^(left|right)$/);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("user-flip");
    });
    const rememberedSide = floatingPanel.getAttribute("data-forced-side");

    act(() => {
      fireEvent.click(fridayChips[1]);
    });

    await waitFor(() => {
      expect(floatingPanel.getAttribute("data-forced-side")).toBe(rememberedSide);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("user-flip");
    });

    act(() => {
      fireEvent.click(mondayChip);
    });

    await waitFor(() => {
      expect(floatingPanel.hasAttribute("data-forced-side")).toBe(false);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("auto");
    });

    act(() => {
      fireEvent.click(fridayChips[0]);
    });

    await waitFor(() => {
      expect(floatingPanel.hasAttribute("data-forced-side")).toBe(false);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("auto");
    });
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

  it("opens a staged floating workspace when entering editor mode", async () => {
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

      fireEvent.keyDown(document, { key: "c" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-event-editor-rail").getAttribute("data-editor-layout")).toBe("desktop-staged");
      expect(screen.getByTestId("calendar-event-editor-detail-layout").getAttribute("data-layout-mode")).toBe("desktop-staged");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.queryByTestId("calendar-modal-editor-expanded")).toBeNull();
      expect(body.style.gridTemplateColumns).toContain("320px");
      expect(screen.getByTestId("calendar-cell-23")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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

  it("switches the selected deadline in-place when a different agenda row is clicked", async () => {
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

    const agendaRail = screen.getByTestId("deadlines-agenda-rail");
    expect(within(agendaRail).getAllByText("First task").length).toBeGreaterThan(0);
    fireEvent.click(within(agendaRail).getAllByTestId("calendar-agenda-deadline-row")[1]);
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Second task");
  });

  it("opens a blank floating Todoist editor from the deadlines header", async () => {
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
    expect(screen.getAllByText(/Apr 20/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("deadlines-agenda-rail")).toBeTruthy();
  });

  it("opens floating bill detail from a bills agenda row", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{
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
          payeeMap: { "payee-1": "Landlord" },
        }}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = screen.getByTestId("bills-agenda-rail");
    fireEvent.click(within(agendaRail).getByTestId("calendar-agenda-bill-row"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("opens agenda-anchored floating bill detail from dashboard item focus", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="bill-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{
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
          payeeMap: { "payee-1": "Landlord" },
        }}
        deadlinesData={{}}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("opens dashboard item focus after async deadline data resolves", async () => {
    window.innerWidth = 1900;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          isLoading: true,
          ctm: { upcoming: [] },
          todoist: { upcoming: [] },
        }}
      />,
    ));

    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        focusOpenDetail
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

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
  });

  it("keeps Bills and Deadlines stacked layouts on the timeline detail rail", async () => {
    window.innerWidth = 1100;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "bill-1",
              name: "Rent",
              next_date: "2026-04-20",
              paid: false,
              type: "bill",
              conditions: [{ field: "amount", value: { num1: 180000 } }],
            },
          ],
        }}
        deadlinesData={{}}
      />,
    ));

    expect(await screen.findByTestId("timeline-detail-rail")).toBeTruthy();
    expect(screen.queryByTestId("bills-agenda-rail")).toBeNull();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: { upcoming: [{ id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" }] },
          todoist: { upcoming: [] },
        }}
      />,
    ));

    expect(await screen.findByTestId("timeline-detail-rail")).toBeTruthy();
    expect(screen.queryByTestId("deadlines-agenda-rail")).toBeNull();
  });

  it("opens a blank inline Todoist editor from a deadlines create focus request", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusItemId="new"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(getLatestRailContent().getAttribute("data-rail-motion")).toBe("standard");
  });

  it("keeps a future-date deadline draft active after ghost navigation", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-30"
        focusItemId="new"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    const input = await screen.findByPlaceholderText(/Buy groceries tomorrow/i);
    fireEvent.change(input, {
      target: { value: "Plan sprint May 2 at 9am" },
    });

    expect((await screen.findByTestId("todoist-draft-preview-summary")).textContent).toContain("2026-05-02");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2026/i);
    }, { timeout: 1500 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2026/i);
    expect(screen.getByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByDisplayValue("Plan sprint May 2 at 9am")).toBeTruthy();
    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("2026-05-02");
  });

  it("opens event create after closing a Todoist create focus request", async () => {
    window.innerWidth = 1900;
    const props = {
      onClose: () => {},
      onViewChange: () => {},
      eventsData: {
        editable: true,
        getEvents: () => [],
      },
      billsData: {},
      deadlinesData: { todoist: { upcoming: [] } },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...props}
        open
        openRequestId={1}
        view="deadlines"
        focusItemId="new"
      />,
    ));

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();

    rerender(wrapWithDashboard(
      <CalendarModal
        {...props}
        open={false}
        openRequestId={1}
        view="deadlines"
        focusItemId="new"
      />,
    ));

    rerender(wrapWithDashboard(
      <CalendarModal
        {...props}
        open
        openRequestId={2}
        view="events"
        focusItemId="new"
      />,
    ));

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).not.toBe("editor");
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
    expect(screen.getAllByText(/Apr 20/i).length).toBeGreaterThan(0);
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

    fireEvent.click(within(screen.getByTestId("deadlines-agenda-rail")).getByTestId("calendar-agenda-deadline-row"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByDisplayValue("First task")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(getLatestRailContent().getAttribute("data-rail-motion")).toBe("standard");
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
    expect(screen.getByTestId("deadlines-agenda-rail")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(onClose).not.toHaveBeenCalled();
  });
});
