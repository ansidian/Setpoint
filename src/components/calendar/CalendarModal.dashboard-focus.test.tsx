import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal dashboard focus behavior", () => {
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

    const panel = await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 });
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
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 });
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-deadline-row");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
  });

  it("activates a dashboard-focused deadline without issuing an item scroll", async () => {
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
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const agendaRail = await screen.findByTestId("events-agenda-rail", {}, { timeout: 5000 });
    const agendaHeader = agendaRail.querySelector("[data-agenda-date-header='true']")!;
    const agendaRow = within(agendaRail).getByTestId("calendar-agenda-deadline-row");
    agendaRail.scrollTo = (options) => {
      agendaRail.scrollTop = typeof options === "number" ? options : options?.top ?? 0;
    };
    agendaRail.scrollTop = 0;
    agendaRail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 } as DOMRect);
    agendaHeader.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 280, width: 280, height: 34 } as DOMRect);
    agendaRow.getBoundingClientRect = () => ({ top: 400, bottom: 444, left: 0, right: 280, width: 280, height: 44 } as DOMRect);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-deadline-row");
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
    expect(agendaRail.scrollTop).toBe(0);
  });

  it("treats dashboard item focus as a one-shot request after the floating detail closes", async () => {
    window.innerWidth = 1900;

    const deadlineProps = {
      open: true,
      openRequestId: 7,
      onClose: () => {},
      onViewChange: () => {},
      focusDate: "2026-04-20",
      focusItemId: "deadline:deadline-1:2026-04-20",
      focusOpenDetail: true,
      eventsData: { getEvents: () => [] },
      billsData: {},
      deadlinesData: {
        upcoming: [
          { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
        ],
      },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="events"
        forceDeadlineOverlay
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 });
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    fireEvent.click(within(panel).getByRole("button", { name: /close floating detail/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    rerender(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="events"
        forceDeadlineOverlay
      />,
    ));
    rerender(wrapWithDashboard(
      <CalendarModal
        {...deadlineProps}
        view="events"
        forceDeadlineOverlay
      />,
    ));

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
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
        view="events"
        forceDeadlineOverlay
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
            { id: "deadline-2", title: "Lab due", due_date: "2026-04-21", status: "open" },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 });
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");

    const secondChip = within(screen.getByTestId("calendar-cell-21"))
      .getByText("Lab due")
      .closest("[data-testid='calendar-cell-item-chip']");
    fireEvent.click(secondChip!);

    await waitFor(() => {
      expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Lab due");
    });

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-deadline-title").textContent).toContain("Lab due");
  });

  it("opens dashboard item focus after async deadline data resolves", async () => {
    window.innerWidth = 1900;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          isLoading: true,
          upcoming: [],
        }}
      />,
    ));

    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" },
          ],
        }}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 });
    expect(within(panel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Project due");
  });
});
