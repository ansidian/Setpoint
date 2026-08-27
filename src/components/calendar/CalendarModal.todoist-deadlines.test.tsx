import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal deadlines rail behavior", () => {
  it("opens existing deadline detail from an Events overlay chip without changing view", async () => {
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
            { id: "todo-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByText("Project due"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(screen.getByText(/Calendar Workspace/).textContent).toContain("Events");
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

  it("opens deadline detail from an Events agenda row", async () => {
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

});
