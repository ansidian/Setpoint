import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal deadlines rail behavior", () => {
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
        deadlinesData={{ upcoming: [] }}
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
        billsRangeData={{ ensureRange: () => Promise.resolve(), data: null }}
        deadlinesData={{ upcoming: [] }}
      />,
    ));

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    const tabs = within(list).getAllByRole("tab");
    const tabLabels = tabs.map((t) => t.textContent);
    expect(tabLabels.some((l) => /events/i.test(l))).toBe(true);
    expect(tabLabels.some((l) => /bills/i.test(l))).toBe(true);
    expect(tabLabels.some((l) => /deadlines/i.test(l))).toBe(false);
  });

  it("does not route the 3 hotkey to a third workspace", () => {
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
        deadlinesData={{ upcoming: [] }}
      />,
    ));

    fireEvent.keyDown(document, { key: "3" });

    expect(onViewChange).not.toHaveBeenCalled();
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
          upcoming: [
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByText("Project due"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("tints a focused Events deadline overlay chip when the focus id is a raw Todoist id", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="todo-1"
        focusOpenDetail
        eventsData={{
          editable: true,
          getEvents: () => [],
        }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    const chip = within(screen.getByTestId("calendar-cell-20"))
      .getByText("Project due")
      .closest("[data-testid='calendar-cell-item-chip']");
    expect(chip?.getAttribute("data-selected")).toBe("true");
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
          upcoming: [
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
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
          upcoming: [
            { id: "todo-current", title: "Current dashboard task", due_date: "2026-04-20", status: "open" },
          ],
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

  it("preserves a focused deadline day and item when the modal opens into Events", async () => {
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
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const agendaRail = screen.getByTestId("events-agenda-rail");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(within(agendaRail).getAllByText("Project due").length).toBeGreaterThan(0);
    const row = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    expect(row.getAttribute("data-item-id")).toBe("deadline:deadline-1:2026-04-20");

    fireEvent.click(row);

    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(screen.getAllByRole("button", { name: /^complete$/i }).length).toBeGreaterThan(0);
  });

  // The stale-completed-vs-live-open occurrence resolution rule is owned by the
  // model test in src/hooks/calendar/calendarControllerHelpers.test.js
  // ("resolvePendingFocusItem activates the live recurring occurrence when
  // focus targets a stale completed one"). This keeps only the DOM proof that
  // the controller routes the resolved occurrence into the detail panel.
  it("activates the live recurring Todoist occurrence when dashboard focus has a stale due date", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-21"
        focusItemId="deadline:todo-rec:2026-04-21"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-rec", title: "Completed occurrence", due_date: "2026-04-21", status: "complete", is_recurring: true },
            { id: "todo-rec", title: "Current occurrence", due_date: "2026-04-23", status: "open", is_recurring: true },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Current occurrence");
  });

  it("falls back to a completed deadline when a day has no active items", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
          ],
        }}
      />,
    ));

    const agendaRail = screen.getByTestId("events-agenda-rail");
    expect(within(agendaRail).getAllByText("Project due").length).toBeGreaterThan(0);
    const row = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    expect(within(row).getByText("Complete")).toBeTruthy();

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
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          isLoading: true,
          upcoming: [],
        }}
      />,
    ));

    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
  });

  it("keeps rendered deadlines visible and shows pending status during refresh", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:todo-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
        deadlinesRangeData={{
          loading: true,
          error: null,
          ensureRange: vi.fn().mockResolvedValue({}),
          data: {
            upcoming: [
              {
                id: "todo-1",
                title: "Backfill notes",
                due_date: "2026-04-20",
                due_time: "9:00 AM",
                class_name: "Inbox",
                status: "open",
              },
            ],
          },
        }}
      />,
    ));

    const activeGrid = screen.getByTestId("calendar-grid-shell");
    expect(within(activeGrid).queryByTestId("calendar-grid-skeleton")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Backfill notes")).toBeTruthy();
  });

  // Composite-id format (deadline:<id>:<dateKey>) and the showCompleted
  // retention rule are owned by the model tests in
  // src/components/calendar/views/events/eventsPlanningModel.test.js
  // ("normalizes deadline range data into overlay items..." / "keys deadline
  // planning ids by occurrence date") and deadlinesModel.test.ts
  // ("uses deadline occurrence identity for every deadline row"). This keeps
  // only the DOM presence guard that a completed-only deadline still surfaces
  // a chip in the month cell preview.
  it("still renders a completed-only deadline chip in the month cell preview", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-21"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
          ],
        }}
      />,
    ));

    expect(within(screen.getByTestId("calendar-cell-20")).getByText("Project due")).toBeTruthy();
  });

  it("uses the event-style font treatment for the selected deadline title", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const row = within(screen.getByTestId("events-agenda-rail")).getByTestId("calendar-agenda-deadline-row");
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

  it("does not refetch the deadlines range when only range data object identity changes", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue({});
    const ensureEventsRange = vi.fn().mockResolvedValue([]);

    function modal(deadlineId: string) {
      return wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          forceDeadlineOverlay
          onViewChange={() => {}}
          focusDate="2026-04-20"
          eventsData={{ ensureRange: ensureEventsRange, getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{}}
          deadlinesRangeData={{
            loading: false,
            error: null,
            ensureRange,
            data: {
              upcoming: [
                {
                  id: deadlineId,
                  title: "Deadline",
                  due_date: "2026-04-20",
                  status: "incomplete",
                },
              ],
            },
          }}
        />,
      );
    }

    const { rerender } = render(modal("todo-1"));

    await waitFor(() => {
      expect(ensureRange.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    const initialCallCount = ensureRange.mock.calls.length;

    rerender(modal("todo-1"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(ensureRange).toHaveBeenCalledTimes(initialCallCount);
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
      deadlinesData: { upcoming: [] },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...props}
        open
        openRequestId={1}
        view="events"
        forceDeadlineOverlay
        focusItemId="new"
      />,
    ));

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();

    rerender(wrapWithDashboard(
      <CalendarModal
        {...props}
        open={false}
        openRequestId={1}
        view="events"
        forceDeadlineOverlay
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
});
