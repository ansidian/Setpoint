import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import useCalendarModalController from "./useCalendarModalController.jsx";

let latestShellProps = null;

vi.mock("../../components/calendar/modal/CalendarModalShell.jsx", () => ({
  default: vi.fn((props) => {
    latestShellProps = props;
    return <div ref={props.panelRef} data-testid="calendar-modal-shell" />;
  }),
}));

vi.mock("@/api", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: vi.fn().mockResolvedValue({ accounts: [] }),
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

vi.mock("../../api.js", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: vi.fn().mockResolvedValue({ accounts: [] }),
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

function Harness(props) {
  return useCalendarModalController(props);
}

function wrap(node) {
  return (
    <DashboardProvider
      briefing={{ emails: { accounts: [] }, deadlines: { upcoming: [] } }}
      setBriefing={() => {}}
      setCalendarDeadlines={() => {}}
    >
      {node}
    </DashboardProvider>
  );
}

function renderHarness(overrides = {}) {
  return render(wrap(
    <Harness
      open
      onClose={() => {}}
      view="events"
      onViewChange={() => {}}
      focusDate="2026-05-12"
      eventsData={{
        getEvents: (year, month) => (
          year === 2026 && month === 6
            ? [{
                id: "event-9",
                title: "Planning target",
                startMs: Date.parse("2026-07-14T17:00:00.000Z"),
                endMs: Date.parse("2026-07-14T18:00:00.000Z"),
                allDay: false,
              }]
            : []
        ),
      }}
      billsData={{}}
      deadlinesData={{}}
      {...overrides}
    />,
  ));
}

describe("useCalendarModalController search wiring", () => {
  beforeEach(() => {
    latestShellProps = null;
    window.innerWidth = 1440;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens and focuses calendar search on Cmd/Ctrl+F", async () => {
    renderHarness();

    fireEvent.keyDown(document, { key: "f", metaKey: true });

    await waitFor(() => {
      expect(latestShellProps.search.open).toBe(true);
      expect(latestShellProps.search.focusRequestId).toBeGreaterThan(0);
    });
  });

  it("cancels open calendar search with Escape before closing the modal", async () => {
    const onClose = vi.fn();
    renderHarness({ onClose });

    act(() => {
      latestShellProps.search.openSearch();
      latestShellProps.search.setQuery("planning");
    });

    await waitFor(() => {
      expect(latestShellProps.search.open).toBe(true);
      expect(latestShellProps.search.query).toBe("planning");
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(latestShellProps.search.open).toBe(true);
      expect(latestShellProps.search.query).toBe("");
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(latestShellProps.search.open).toBe(false);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets command-number view switching work while calendar search is focused", async () => {
    const onViewChange = vi.fn();
    renderHarness({ view: "events", onViewChange });

    act(() => {
      latestShellProps.search.openSearch();
    });

    await waitFor(() => expect(latestShellProps.search.open).toBe(true));

    const input = document.createElement("input");
    input.setAttribute("data-testid", "calendar-search-input");
    const rail = document.createElement("div");
    rail.setAttribute("data-suspend-calendar-hotkeys", "true");
    rail.appendChild(input);
    document.body.appendChild(rail);
    input.focus();

    fireEvent.keyDown(input, { key: "2", metaKey: true });

    expect(onViewChange).toHaveBeenCalledWith("bills");

    rail.remove();
  });

  it("activation navigates to the result month, selects the item, and keeps search open", async () => {
    renderHarness();

    act(() => {
      latestShellProps.search.openSearch();
    });

    await waitFor(() => expect(latestShellProps.search.open).toBe(true));

    act(() => {
      latestShellProps.search.activateResult({
        type: "event",
        itemId: "event-9",
        itemDate: "2026-07-14",
        activation: {
          view: "events",
          detailView: "events",
          dateKey: "2026-07-14",
          itemId: "event-9",
        },
      });
    });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(6);
      expect(latestShellProps.selectedDateKey).toBe("2026-07-14");
      expect(latestShellProps.effectiveSelectedItemId).toBe("event-9");
      expect(latestShellProps.search.open).toBe(true);
    });
  });

  it("selects a search result on a visible trailing grid day without jumping months", async () => {
    renderHarness({
      focusDate: "2026-04-20",
      eventsData: {
        getEvents: (year, month) => (
          year === 2026 && month === 4
            ? [{
                id: "event-trailing",
                title: "Trailing target",
                startMs: Date.parse("2026-05-02T17:00:00.000Z"),
                endMs: Date.parse("2026-05-02T18:00:00.000Z"),
                allDay: false,
              }]
            : []
        ),
      },
    });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(3);
    });

    act(() => {
      latestShellProps.search.openSearch();
    });

    await waitFor(() => expect(latestShellProps.search.open).toBe(true));

    act(() => {
      latestShellProps.search.activateResult({
        type: "event",
        itemId: "event-trailing",
        itemDate: "2026-05-02",
        activation: {
          view: "events",
          detailView: "events",
          dateKey: "2026-05-02",
          itemId: "event-trailing",
        },
      });
    });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(3);
      expect(latestShellProps.selectedDateKey).toBe("2026-05-02");
      expect(latestShellProps.effectiveSelectedItemId).toBe("event-trailing");
    });
  });

  it("opens floating detail anchored to the clicked search result row", async () => {
    renderHarness();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);

    act(() => {
      latestShellProps.search.openSearch();
    });

    await waitFor(() => expect(latestShellProps.search.open).toBe(true));

    act(() => {
      latestShellProps.search.activateResult({
        type: "event",
        itemId: "event-9",
        itemDate: "2026-07-14",
        activation: {
          view: "events",
          detailView: "events",
          dateKey: "2026-07-14",
          itemId: "event-9",
        },
      }, {
        anchorElement: anchor,
        sourceCellElement: anchor,
        anchorKind: "search-result-row",
      });
    });

    await waitFor(() => {
      expect(latestShellProps.floatingDetail).toMatchObject({
        open: true,
        mode: "detail",
        view: "events",
        itemId: "event-9",
        dateKey: "2026-07-14",
        anchorKind: "search-result-row",
      });
      expect(latestShellProps.floatingDetail.anchorElement).toBe(anchor);
      expect(latestShellProps.search.open).toBe(true);
    });

    anchor.remove();
  });

  it("opens keyboard search activation from the month-grid chip anchor", async () => {
    renderHarness({
      focusDate: "2026-07-14",
    });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(6);
    });

    const panel = screen.getByTestId("calendar-modal-shell");
    panel.innerHTML = `
      <div role="gridcell" data-date-key="2026-07-14">
        <button data-testid="calendar-cell-item-chip" data-item-id="event-9">Planning target</button>
      </div>
    `;
    const chip = panel.querySelector("[data-testid='calendar-cell-item-chip']");

    act(() => {
      latestShellProps.search.openSearch();
      latestShellProps.search.activateResult({
        type: "event",
        itemId: "event-9",
        itemDate: "2026-07-14",
        activation: {
          view: "events",
          detailView: "events",
          dateKey: "2026-07-14",
          itemId: "event-9",
        },
      }, {
        anchorKind: "grid-chip",
      });
    });

    await waitFor(() => {
      expect(latestShellProps.floatingDetail).toMatchObject({
        open: true,
        mode: "detail",
        view: "events",
        itemId: "event-9",
        dateKey: "2026-07-14",
        anchorKind: "chip",
      });
      expect(latestShellProps.floatingDetail.anchorElement).toBe(chip);
    });
  });

  it("keeps search results navigable when their current grid chip is hidden in overflow", async () => {
    renderHarness({ focusDate: "2026-07-14" });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(6);
    });

    const result = {
      type: "event",
      itemId: "event-9",
      itemDate: "2026-07-14",
      activation: {
        view: "events",
        detailView: "events",
        dateKey: "2026-07-14",
        itemId: "event-9",
      },
    };
    const row = document.createElement("button");

    expect(latestShellProps.search.isResultNavigable(result)).toBe(true);
    expect(latestShellProps.search.getResultActivationContext(result, 0, {
      anchorElement: row,
      sourceCellElement: row,
    })).toEqual({
      anchorKind: "search-result-row",
      anchorElement: row,
      sourceCellElement: row,
    });
  });

  it("keeps mirrored event search rows navigable when the current grid has not materialized the event", async () => {
    renderHarness({ focusDate: "2026-05-12" });

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(4);
    });

    const result = {
      type: "event",
      itemId: "mirror-work-1",
      itemDate: "2026-05-12",
      activation: {
        view: "events",
        detailView: "events",
        dateKey: "2026-05-12",
        itemId: "mirror-work-1",
      },
    };
    const row = document.createElement("button");

    expect(latestShellProps.search.isResultNavigable(result)).toBe(true);
    expect(latestShellProps.search.getResultActivationContext(result, 0, {
      anchorElement: row,
      sourceCellElement: row,
    })).toEqual({
      anchorKind: "search-result-row",
      anchorElement: row,
      sourceCellElement: row,
    });
  });

  it("keeps deadline search results navigable even when the deadline overlay is currently hidden", async () => {
    window.localStorage.setItem("calendar:eventsDeadlineOverlay", "false");
    renderHarness();

    await waitFor(() => expect(latestShellProps.search.open).toBe(false));

    const result = {
      type: "deadline",
      itemId: "deadline:todo-1:2026-05-12",
      itemDate: "2026-05-12",
      status: "open",
      activation: {
        view: "events",
        detailKind: "deadline",
        dateKey: "2026-05-12",
        itemId: "deadline:todo-1:2026-05-12",
      },
      payload: { id: "todo-1", status: "open" },
    };

    expect(latestShellProps.search.isResultNavigable(result)).toBe(true);
  });

  it("opens hidden-overlay deadline search results without mutating the overlay preference", async () => {
    window.localStorage.setItem("calendar:eventsDeadlineOverlay", "false");
    renderHarness();
    const row = document.createElement("button");
    document.body.appendChild(row);

    await waitFor(() => {
      expect(latestShellProps.viewData.deadlineOverlay.enabled).toBe(false);
    });

    const result = {
      type: "deadline",
      itemId: "deadline:todo-1:2026-05-12",
      itemDate: "2026-05-12",
      title: "Hidden deadline",
      status: "complete",
      activation: {
        view: "events",
        detailKind: "deadline",
        dateKey: "2026-05-12",
        itemId: "deadline:todo-1:2026-05-12",
      },
      payload: {
        id: "todo-1",
        dueDate: "2026-05-12",
        status: "complete",
      },
    };

    const context = latestShellProps.search.getResultActivationContext(result, 0, {
      anchorElement: row,
      sourceCellElement: row,
    });

    expect(context).toMatchObject({ anchorKind: "search-result-row" });

    act(() => {
      latestShellProps.search.activateResult(result, context);
    });

    await waitFor(() => {
      expect(latestShellProps.floatingDetail).toMatchObject({
        open: true,
        mode: "detail",
        view: "events",
        detailKind: "deadline",
        itemId: "deadline:todo-1:2026-05-12",
        dateKey: "2026-05-12",
        anchorKind: "search-result-row",
        itemsSnapshot: [expect.objectContaining({
          id: "todo-1",
          agendaItemId: "deadline:todo-1:2026-05-12",
          status: "complete",
        })],
      });
      expect(latestShellProps.viewData.deadlineOverlay.enabled).toBe(false);
      expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");
    });

    act(() => {
      latestShellProps.onCloseFloatingDetail();
    });

    await waitFor(() => {
      expect(latestShellProps.floatingDetail).toBeNull();
      expect(latestShellProps.viewData.deadlineOverlay.enabled).toBe(false);
      expect(window.localStorage.getItem("calendar:eventsDeadlineOverlay")).toBe("false");
    });

    row.remove();
  });

  it("opens floating detail from the search row for mirrored events outside the current grid", async () => {
    renderHarness();
    const row = document.createElement("button");
    document.body.appendChild(row);

    await waitFor(() => {
      expect(latestShellProps.viewYear).toBe(2026);
      expect(latestShellProps.viewMonth).toBe(4);
    });

    const result = {
      type: "event",
      itemId: "mirror-work-1",
      itemDate: "2026-07-14",
      title: "Work",
      sourceLabel: "Work",
      sourceColor: "#4285f4",
      activation: {
        view: "events",
        detailView: "events",
        dateKey: "2026-07-14",
        itemId: "mirror-work-1",
      },
      payload: {
        id: "mirror-work-1",
        startMs: Date.parse("2026-07-14T17:00:00.000Z"),
        endMs: Date.parse("2026-07-14T18:00:00.000Z"),
        allDay: false,
      },
    };

    const context = latestShellProps.search.getResultActivationContext(result, 0, {
      anchorElement: row,
      sourceCellElement: row,
    });

    expect(context).toMatchObject({ anchorKind: "search-result-row" });

    act(() => {
      latestShellProps.search.activateResult(result, context);
    });

    await waitFor(() => {
      expect(latestShellProps.floatingDetail).toMatchObject({
        open: true,
        mode: "detail",
        view: "events",
        itemId: "mirror-work-1",
        dateKey: "2026-07-14",
        anchorKind: "search-result-row",
      });
      expect(latestShellProps.floatingDetail.anchorElement).toBe(row);
    });

    row.remove();
  });
});
