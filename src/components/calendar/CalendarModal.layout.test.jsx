import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import CalendarModal from "./CalendarModal.jsx";

const mockGetCalendarSources = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  getCalendarPlaceSuggestions: vi.fn(),
  getCalendarPlaceDetails: vi.fn(),
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getTodoistProjects: vi.fn().mockResolvedValue([]),
  getTodoistLabels: vi.fn().mockResolvedValue([]),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.localStorage.removeItem("calendar:eventsDeadlineOverlay");
  window.localStorage.removeItem("calendar:eventsCompletedDeadlines");
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

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

function pointerClick(element) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

function stubRect(element, rect) {
  element.getBoundingClientRect = vi.fn(() => ({
    width: 100,
    height: 24,
    left: 0,
    right: 100,
    bottom: 124,
    ...rect,
  }));
}

describe("CalendarModal responsive layout", () => {
  it("keeps the modal workspace usable across desktop and compact widths", async () => {
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
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
    expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();

    await act(async () => {
      window.innerWidth = 1240;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
    });

    await act(async () => {
      window.innerWidth = 1100;
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
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

    expect(monthGrid).toBeTruthy();
    expect(skeleton).toBeTruthy();
    expect(screen.getByTestId("calendar-events-rail-skeleton")).toBeTruthy();
  });

  it("opens the search rail from the header and keeps three desktop columns when space allows", async () => {
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

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("three-rail");
      expect(screen.getByTestId("calendar-modal-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-search-input")).toBe(document.activeElement);
    });
  });

  it("lets search replace the agenda rail on constrained layouts", async () => {
    window.innerWidth = 1240;

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

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("search-replaces-agenda");
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.queryByTestId("calendar-modal-rail")).toBeNull();
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
    });
  });

  it("keeps stacked search usable without overlapping the grid", async () => {
    window.innerWidth = 900;

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

    fireEvent.click(screen.getByTestId("calendar-search-header-button"));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-modal-body").getAttribute("data-search-layout")).toBe("stacked-replaces-agenda");
      expect(screen.getByTestId("calendar-search-rail")).toBeTruthy();
      expect(screen.getByTestId("calendar-grid-month")).toBeTruthy();
      expect(screen.queryByTestId("calendar-modal-rail")).toBeNull();
    });
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
          data: {
            ctm: { upcoming: [] },
            todoist: { upcoming: [] },
          },
          dataRange: null,
          ensureRange: ensureDeadlines,
        }}
      />,
    ));

    expect(screen.getByTestId("calendar-grid-skeleton")).toBeTruthy();
    expect(screen.queryByText("Design review")).toBeNull();
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
          return { top: 0, bottom: 320, left: 0, right: 280, width: 280, height: 320 };
        }
        if (
          this.getAttribute?.("data-agenda-date-header") === "true"
          && this.getAttribute?.("data-date-key") === "2026-05-11"
        ) {
          return { top: 100, bottom: 134, left: 0, right: 280, width: 280, height: 34 };
        }
        if (this.getAttribute?.("data-testid") === "calendar-agenda-event-row") {
          return { top: 800, bottom: 844, left: 0, right: 280, width: 280, height: 44 };
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
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
        delete HTMLElement.prototype.scrollTo;
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
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
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
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("true");
    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("April 23, 2026");
  });

  it("opens deadline create from an Events deadline-overlay focus request", async () => {
    window.innerWidth = 1900;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-06T19:00:00.000Z"));

    render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusItemId="new"
        forceDeadlineOverlay
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-caret")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("May 6, 2026");
    expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBeNull();
  });

  it("does not expose Deadlines as a standalone calendar view", () => {
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
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    expect(screen.getByRole("button", { name: /events view/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bills view/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deadlines view/i })).toBeNull();
  });

  it("does not route the 3 hotkey to a standalone Deadlines view", () => {
    window.innerWidth = 1900;
    const onViewChange = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={onViewChange}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    fireEvent.keyDown(document, { key: "3" });

    expect(onViewChange).not.toHaveBeenCalledWith("deadlines");
  });

  it("opens existing deadline detail from an Events overlay chip without changing view", async () => {
    window.innerWidth = 1900;
    const onViewChange = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={onViewChange}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByText("Project due"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("edits selected Todoist overlay items from the Events E hotkey", async () => {
    window.innerWidth = 1900;
    const onViewChange = vi.fn();

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={onViewChange}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByText("Project due"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    fireEvent.keyDown(document, { key: "e" });

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(onViewChange).not.toHaveBeenCalled();
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
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Project due", due_date: "2026-04-20", source: "todoist", status: "complete" },
            ],
          },
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
            ctm: { upcoming: [] },
            todoist: {
              upcoming: [
                { id: "todo-seeded", title: "Seeded task", due_date: "2026-04-20", source: "todoist", status: "open" },
              ],
            },
          },
          ensureRange: ensureDeadlines,
        }}
      />,
    ));

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Seeded task")).toBeTruthy();
  });

  it("uses dashboard deadline data as an Events overlay seed while the range request is pending", () => {
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
        deadlinesData={{
          ctm: { upcoming: [] },
          todoist: {
            upcoming: [
              { id: "todo-current", title: "Current dashboard task", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
        }}
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
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-current", title: "Current dashboard task", due_date: "2026-04-20", source: "todoist", status: "open" },
        ],
      },
    };
    const rangeDeadlines = {
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-range", title: "Range task", due_date: "2026-04-20", source: "todoist", status: "open" },
        ],
      },
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
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Open task", due_date: "2026-04-20", source: "todoist", status: "open" },
              { id: "todo-2", title: "Done task", due_date: "2026-04-20", source: "todoist", status: "complete" },
            ],
          },
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
          deadlinesData={{ todoist: { upcoming: [] } }}
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
          todoist: {
            upcoming: [
              { id: "late", title: "Late deadline", due_date: "2026-04-20", source: "todoist", status: "open" },
            ],
          },
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
    expect(row.getAttribute("data-item-id")).toBe("canvas:deadline-1");

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

  it("activates a dashboard-focused deadline without issuing an item scroll", async () => {
    window.innerWidth = 1900;
    const scrollTo = vi.fn();

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

    const agendaRail = screen.getByTestId("deadlines-agenda-rail");
    const agendaHeader = agendaRail.querySelector("[data-agenda-date-header='true']");
    const agendaRow = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    agendaRail.scrollTo = scrollTo;
    agendaRail.scrollTop = 0;
    agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    agendaHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 });
    agendaRow.getBoundingClientRect = () => ({ top: 400, bottom: 444, left: 0, right: 280, width: 280, height: 44 });
    const clickRow = agendaRow.click.bind(agendaRow);
    const clickSpy = vi.spyOn(agendaRow, "click").mockImplementation(() => clickRow());
    scrollTo.mockClear();

    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(clickSpy).toHaveBeenCalled();
    expect(scrollTo.mock.calls.some(([command]) => command?.top > 0)).toBe(false);
  });

  it("activates the live recurring Todoist occurrence when dashboard focus has a stale due date", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-21"
        focusItemId="todo-rec"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-rec", title: "Completed occurrence", due_date: "2026-04-21", source: "todoist", status: "complete", is_recurring: true },
              { id: "todo-rec", title: "Current occurrence", due_date: "2026-04-23", source: "todoist", status: "open", is_recurring: true },
            ],
          },
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Current occurrence");
  });

  it("closes a completed deadline floating detail when completed agenda rows are hidden", async () => {
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
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
            ],
          },
        }}
      />,
    ));

    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide completed deadlines/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(within(screen.getByTestId("deadlines-agenda-rail")).queryByText("Project due")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Project due")).toBeNull();
  });

  it("treats dashboard item focus as a one-shot request after the floating detail closes", async () => {
    window.innerWidth = 1900;

    const deadlineProps = {
      open: true,
      openRequestId: 7,
      onClose: () => {},
      onViewChange: () => {},
      focusDate: "2026-04-20",
      focusItemId: "deadline-1",
      focusOpenDetail: true,
      eventsData: { getEvents: () => [] },
      billsData: {},
      deadlinesData: {
        ctm: {
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        },
      },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="deadlines"
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    fireEvent.click(within(panel).getByRole("button", { name: /close floating detail/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    rerender(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="events"
      />,
    ));
    rerender(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="deadlines"
      />,
    ));

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
  });

  it("does not reselect the dashboard-origin detail after clicking another deadline chip", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={8}
        onClose={() => {}}
        onViewChange={() => {}}
        view="deadlines"
        focusDate="2026-04-20"
        focusItemId="deadline-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          ctm: {
            upcoming: [
              { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
              { id: "deadline-2", title: "Lab due", due_date: "2026-04-21", status: "open" },
            ],
          },
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    const secondChip = within(screen.getByTestId("calendar-cell-21"))
      .getByText("Lab due")
      .closest("[data-testid='calendar-cell-item-chip']");
    fireEvent.click(secondChip);

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Lab due");
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Lab due");
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

  it("keeps rendered deadlines visible and shows pending status during refresh", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
        deadlinesRangeData={{
          loading: true,
          error: null,
          ensureRange: vi.fn().mockResolvedValue({}),
          data: {
            todoist: {
              upcoming: [
                {
                  id: "todo-1",
                  title: "Backfill notes",
                  due_date: "2026-04-20",
                  due_time: "9:00 AM",
                  source: "todoist",
                  class_name: "Inbox",
                  status: "open",
                },
              ],
            },
          },
        }}
      />,
    ));

    expect(screen.queryByTestId("calendar-grid-skeleton")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Backfill notes")).toBeTruthy();
    expect(screen.getByTestId("calendar-pending-update").getAttribute("aria-label")).toBe("Calendar updates pending");
    expect(screen.getByTestId("calendar-pending-update").querySelector(".calendar-pending-update-icon")).toBeTruthy();

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Backfill notes");
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
    expect(quietChip?.getAttribute("data-item-id")).toBe("canvas:deadline-1");
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

    expect((await screen.findByTestId("calendar-selected-deadline-title")).textContent).toContain("Project due");
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
      expect(within(agendaRail).getByText("No Events")).toBeTruthy();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

      fireEvent.click(todayCell);

      expect(within(screen.getByTestId("calendar-cell-20")).queryByTestId("calendar-selected-empty-cell-placeholder")).toBeNull();
      expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the no-selection rail in agenda mode", () => {
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
    expect(screen.getByTestId("events-agenda-rail").getAttribute("data-calendar-local-scroll")).toBe("true");
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

  it("does not refetch the deadlines range when only range data object identity changes", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue({});

    function modal(deadlineId) {
      return wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="deadlines"
          onViewChange={() => {}}
          focusDate="2026-04-20"
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
          deadlinesRangeData={{
            loading: false,
            error: null,
            ensureRange,
            data: {
              ctm: { upcoming: [] },
              todoist: {
                upcoming: [
                  {
                    id: deadlineId,
                    title: "Deadline",
                    due_date: "2026-04-20",
                    source: "todoist",
                    status: "incomplete",
                  },
                ],
              },
            },
          }}
        />,
      );
    }

    const { rerender } = render(modal("todo-1"));

    await waitFor(() => {
      expect(ensureRange).toHaveBeenCalledTimes(1);
    });

    rerender(modal("todo-1"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(ensureRange).toHaveBeenCalledTimes(1);
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

  it("shows the pending-update indicator for background Bills refreshes with visible data", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{
          loading: true,
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
            recentTransactions: [],
            payeeMap: {},
          },
        }}
        deadlinesData={{}}
      />,
    ));

    const indicator = screen.getByTestId("calendar-pending-update");
    expect(indicator.textContent).toBe("");
    expect(indicator.getAttribute("aria-label")).toBe("Calendar updates pending");
    expect(indicator.querySelector(".calendar-pending-update-icon")).toBeTruthy();
  });

  it("hides the Bills pending-update indicator during initial no-data loading", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{ loading: true, data: null }}
        deadlinesData={{}}
      />,
    ));

    expect(screen.queryByTestId("calendar-pending-update")).toBeNull();
  });

  it("matches utility statement status against mirrored bill payees", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-05-26"
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "water:2026-05-26",
              scheduleId: "water",
              name: "Water Bill",
              payee: "SGV Water",
              next_date: "2026-05-26",
              amount: 50.67,
              paid: false,
              type: "bill",
            },
          ],
          payeeMap: {},
        }}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(screen.getByLabelText("Utility statement status"));

    const waterRow = screen.getByText("Water").parentElement?.parentElement;
    expect(waterRow).toBeTruthy();
    expect(within(waterRow).getByText("next May 26")).toBeTruthy();
  });

  it("refetches the visible Bills range when range data is marked stale", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue({});
    const renderModal = (revision) => wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{
          revision,
          ensureRange,
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
          },
        }}
        deadlinesData={{}}
      />,
    );

    const { rerender } = render(renderModal(0));
    await waitFor(() => expect(ensureRange).toHaveBeenCalledTimes(1));

    rerender(renderModal(1));
    await waitFor(() => expect(ensureRange).toHaveBeenCalledTimes(2));
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

  it("keeps an event create workspace open while wheel-browsing the month grid", async () => {
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-start-date").textContent).toMatch(/Apr 20, 2026/i);
    expect(screen.queryByTestId("calendar-compact-schedule-picker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");

    pointerClick(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
  });

  it("parks a clean event create workspace when month navigation immediately follows opening it", async () => {
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
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
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
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 950));
    });

    const agendaRail = screen
      .getAllByTestId("events-agenda-rail")
      .find((rail) => rail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-05-07']"));
    expect(agendaRail).toBeTruthy();
    stubRect(agendaRail, { top: 100, bottom: 500, height: 400 });
    agendaRail.querySelectorAll("[data-agenda-date-header='true']").forEach((header) => {
      stubRect(header, { top: 600, bottom: 624 });
    });
    const passiveHeader = agendaRail.querySelector("[data-agenda-date-header='true'][data-date-key='2026-05-01']");
    expect(passiveHeader).toBeTruthy();
    stubRect(passiveHeader, {
      top: 90,
      bottom: 114,
    });

    fireEvent.scroll(agendaRail);
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

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

  it("ignores the active dirty event create anchor after returning from park", async () => {
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });

    fireEvent.click(screen.getByTestId("calendar-cell-20"));
    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(screen.getByTestId("calendar-floating-detail-panel").querySelector("[data-calendar-floating-editor-feedback='active']")).toBeNull();
    expect(screen.getByDisplayValue("Rough hold")).toBeTruthy();

    pointerClick(screen.getByTestId("calendar-cell-date-header-2026-04-20"));
    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(screen.getByTestId("calendar-floating-detail-panel").querySelector("[data-calendar-floating-editor-feedback='active']")).toBeNull();
    expect(screen.getByDisplayValue("Rough hold")).toBeTruthy();
  });

  it("keeps an event edit workspace open while wheel-browsing the month grid", async () => {
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
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Design review revised" },
    });
    const scheduleTrigger = within(panel)
      .getAllByTestId("calendar-event-schedule-trigger")
      .find((trigger) => /Apr 20, 2026/i.test(trigger.getAttribute("aria-label") || ""));
    fireEvent.click(scheduleTrigger);
    expect(await screen.findByTestId("calendar-compact-schedule-picker")).toBeTruthy();

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByDisplayValue("Design review revised")).toBeTruthy();
    expect(screen.queryByTestId("calendar-compact-schedule-picker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("chip");
    });
    expect(screen.getByDisplayValue("Design review revised")).toBeTruthy();
  });

  it("returns a clean event edit workspace to its chip anchor without closing it", async () => {
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
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    });

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("chip");
    });
    expect(screen.getByDisplayValue("Design review")).toBeTruthy();
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

  it("ignores the active clean event edit chip after returning from park", async () => {
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });

    pointerClick(screen.getByRole("button", { name: /previous month/i }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("chip");
    });

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByDisplayValue("Design review")).toBeTruthy();
  });

  it("does not replay a stale dirty-block shake on the next event edit workspace", async () => {
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
    let panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    });
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Design review revised" },
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: /close/i }));
    await flushAnimationFrame();
    expect(screen.getByTestId("calendar-floating-detail-panel").querySelector("[data-calendar-floating-editor-feedback='active']")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel editor/i }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("detail");
    });

    panel = screen.getByTestId("calendar-floating-detail-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
    await flushAnimationFrame();

    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-floating-detail-panel").querySelector("[data-calendar-floating-editor-feedback='active']")).toBeNull();
  });

  it("leaves event workspace popovers alone for ignored month-grid wheel gestures", async () => {
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

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaX: 240,
      deltaY: 80,
      deltaMode: 0,
      cancelable: true,
    });

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-compact-schedule-picker")).toBeTruthy();
  });

  it("keeps a Todoist create workspace open and closes transient panels while wheel-browsing the month grid", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="new"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{ todoist: { upcoming: [] } }}
      />,
    ));

    const editor = await screen.findByTestId("todoist-inline-editor");
    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "Submit lab notes" },
    });
    fireEvent.click(screen.getByTestId("todoist-due-trigger"));
    expect(await screen.findByRole("dialog", { name: /todoist due date picker/i })).toBeTruthy();

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
    expect(screen.getByTestId("todoist-inline-editor")).toBe(editor);
    expect(screen.getByDisplayValue("Submit lab notes")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /todoist due date picker/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("day-cell");
    });
    expect(screen.getByDisplayValue("Submit lab notes")).toBeTruthy();
  });

  it("keeps a Todoist edit workspace open while wheel-browsing the month grid", async () => {
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
              {
                id: "todo-1",
                title: "First task",
                due_date: "2026-04-20",
                due_time: "9:00 AM",
                source: "todoist",
                class_name: "Inbox",
                status: "open",
              },
            ],
          },
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("deadlines-agenda-rail")).getByTestId("calendar-agenda-deadline-row"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /^edit$/i }));
    const editor = await screen.findByTestId("todoist-inline-editor");
    fireEvent.change(screen.getByPlaceholderText(/Buy groceries tomorrow/i), {
      target: { value: "First task revised" },
    });
    fireEvent.click(screen.getByTestId("todoist-priority-trigger"));
    expect(await screen.findByRole("option", { name: "P2 High" })).toBeTruthy();

    fireEvent.wheel(screen.getByTestId("calendar-grid-shell"), {
      deltaY: 100,
      deltaMode: 0,
      cancelable: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("todoist-inline-editor")).toBe(editor);
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("parked");
    expect(screen.getByDisplayValue("First task revised")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "P2 High" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("chip");
    });
    expect(screen.getByDisplayValue("First task revised")).toBeTruthy();
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

  it("opens agenda-anchored floating bill detail when dashboard focus uses schedule id and range uses instance id", async () => {
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
        billsData={{}}
        billsRangeData={{
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          },
          loading: false,
          ensureRange: async () => {},
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

  it("keeps floating bill detail open when bills data swaps from schedule id to range instance id", async () => {
    window.innerWidth = 1900;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
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

    const initialPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(initialPanel).getByText("$1,800.00")).toBeTruthy();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
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
        billsRangeData={{
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          },
          loading: false,
          ensureRange: async () => {},
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

  it("moves the selected floating bill detail when a mirror refresh changes the occurrence date", async () => {
    window.innerWidth = 1900;

    const initialBillsRange = {
      data: {
        schedules: [
          {
            id: "bill-1:2026-04-20",
            scheduleId: "bill-1",
            name: "Rent",
            next_date: "2026-04-20",
            amount: 1800,
            paid: false,
            type: "bill",
          },
        ],
        payeeMap: {},
      },
      loading: false,
      ensureRange: async () => {},
    };
    const movedBillsRange = {
      data: {
        schedules: [
          {
            id: "bill-1:2026-04-22",
            scheduleId: "bill-1",
            name: "Rent",
            next_date: "2026-04-22",
            amount: 1900,
            paid: false,
            type: "bill",
          },
        ],
        payeeMap: {},
      },
      loading: false,
      ensureRange: async () => {},
    };

    const renderModal = (billsRangeData) => wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={billsRangeData}
        deadlinesData={{}}
      />,
    );

    const { rerender } = render(renderModal(initialBillsRange));
    const initialCell = await screen.findByTestId("calendar-cell-20");
    fireEvent.click(within(initialCell).getByTestId("calendar-cell-item-chip"));

    const initialPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(initialPanel.getAttribute("data-anchor-kind")).toBe("chip");
    expect(within(initialPanel).getByText("$1,800.00")).toBeTruthy();

    rerender(renderModal(movedBillsRange));

    await waitFor(() => {
      const movedCell = screen.getByTestId("calendar-cell-22");
      const movedChip = within(movedCell).getByTestId("calendar-cell-item-chip");
      expect(movedChip.getAttribute("data-item-id")).toBe("bill-1");
      const movedPanel = screen.getByTestId("calendar-floating-detail-panel");
      expect(movedPanel.getAttribute("data-anchor-kind")).toBe("chip");
      expect(within(movedPanel).getByText("$1,900.00")).toBeTruthy();
    });
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
      target: { value: "Plan sprint May 2 2027 at 9am" },
    });

    expect((await screen.findByTestId("todoist-draft-preview-summary")).textContent).toContain("May 2, 2027 · 9 AM");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2027/i);
    }, { timeout: 1500 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2027/i);
    expect(screen.getByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByDisplayValue("Plan sprint May 2 2027 at 9am")).toBeTruthy();
    expect(screen.getByTestId("todoist-draft-preview-summary").textContent).toContain("May 2, 2027 · 9 AM");
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

  it("does not reuse previous focused deadline state for a clean create request", async () => {
    window.innerWidth = 1900;
    const baseProps = {
      open: true,
      onClose: () => {},
      view: "deadlines",
      onViewChange: () => {},
      eventsData: { getEvents: () => [] },
      billsData: {},
      deadlinesData: {
        todoist: {
          upcoming: [
            { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
          ],
        },
      },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={1}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        focusOpenDetail
      />,
    ));

    const detailPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(detailPanel.getAttribute("data-floating-mode")).toBe("detail");
    expect(within(detailPanel).getByTestId("calendar-selected-deadline-title").textContent).toContain("First task");

    rerender(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={2}
        focusItemId="new"
      />,
    ));

    const inlineEditor = await screen.findByTestId("todoist-inline-editor");
    expect(screen.queryByTestId("todoist-draft-preview-summary")).toBeNull();
    fireEvent.click(within(inlineEditor).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    expect(within(screen.getByTestId("calendar-agenda-deadline-row")).getByText("First task")).toBeTruthy();
  });

  it("does not restore the hero deadline detail when a clean grid-seeded create is cancelled by selecting another day", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="deadlines"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          todoist: {
            upcoming: [
              { id: "todo-1", title: "Hero task", due_date: "2026-04-20", due_time: "9:00 AM", source: "todoist", class_name: "Inbox", status: "open" },
            ],
          },
        }}
      />,
    ));

    const detailPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(detailPanel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Hero task");

    fireEvent.click(screen.getByTestId("calendar-cell-22"));
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /new todoist task due apr 22/i }));
    const inlineEditor = await screen.findByTestId("todoist-inline-editor");
    expect(within(inlineEditor).getByTestId("todoist-draft-preview-summary").textContent).toContain("April 22, 2026");

    fireEvent.click(screen.getByTestId("calendar-cell-23"));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    expect(screen.getAllByText("Hero task").length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-cell-23").getAttribute("aria-selected")).toBe("true");
  });
});
