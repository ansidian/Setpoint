import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal Todoist editor behavior", () => {
  it("switches from an event create to the Todoist create workspace without ghosts or losing the panel", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ editable: true, getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{ upcoming: [] }}
      />,
    ));

    fireEvent.keyDown(document, { key: "c" });
    const eventGhost = await screen.findByTestId("calendar-ghost-chip");
    expect(eventGhost.getAttribute("data-ghost-kind")).toBe("event");

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(document.querySelector('[data-ghost-kind="event"]')).toBeNull();

    // The event-editor dismissal effect runs on an animation frame; the
    // deadline workspace must survive it.
    await flushAnimationFrame();
    await flushAnimationFrame();
    expect(screen.getByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
  });

  it("opens a blank floating Todoist editor from the Events deadline shortcut", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", class_name: "Inbox", status: "open" },
          ],
        }}
      />,
    ));

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getAllByText(/Apr 20/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
  });

  it("opens a blank inline Todoist editor from a deadlines create focus request", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusItemId="new"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{ upcoming: [] }}
      />,
    ));

    expect(await screen.findByTestId("todoist-inline-editor")).toBeTruthy();
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("create");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(getLatestRailContent().getAttribute("data-rail-motion")).toBe("standard");
  });

  it("keeps a future-date deadline draft active after ghost navigation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-30T19:00:00.000Z"));

    try {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          forceDeadlineOverlay
          onViewChange={() => {}}
          focusDate="2026-04-30"
          focusItemId="new"
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          deadlinesData={{ upcoming: [] }}
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the inline Todoist editor from the selected deadline detail", async () => {
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
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", class_name: "Inbox", status: "open" },
          ],
        }}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("events-agenda-rail")).getByTestId("calendar-agenda-deadline-row"));
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
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", class_name: "Inbox", status: "open" },
          ],
        }}
      />,
    ));

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    const inlineEditor = await screen.findByTestId("todoist-inline-editor");
    fireEvent.click(within(inlineEditor).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not reuse previous focused deadline state for a clean create request", async () => {
    window.innerWidth = 1900;
    const baseProps = {
      open: true,
      onClose: () => {},
      view: "events",
      forceDeadlineOverlay: true,
      onViewChange: () => {},
      eventsData: { getEvents: () => [] },
      billsData: {},
      deadlinesData: {
        upcoming: [
          { id: "todo-1", title: "First task", due_date: "2026-04-20", due_time: "9:00 AM", class_name: "Inbox", status: "open" },
        ],
      },
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={1}
        focusDate="2026-04-20"
        focusItemId="deadline:todo-1:2026-04-20"
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
    expect(within(inlineEditor).queryByDisplayValue("First task")).toBeNull();
    fireEvent.click(within(inlineEditor).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    expect(within(screen.getByTestId("calendar-agenda-deadline-row")).getByText("First task")).toBeTruthy();
  });

  it("clears the draft ghost when a clean grid-seeded create is cancelled by selecting another day", async () => {
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
        focusItemId="deadline:todo-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "todo-1", title: "Hero task", due_date: "2026-04-20", due_time: "9:00 AM", class_name: "Inbox", status: "open" },
          ],
        }}
      />,
    ));

    const detailPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(detailPanel).getByTestId("calendar-selected-deadline-title").textContent).toContain("Hero task");

    fireEvent.click(screen.getByTestId("calendar-cell-22"));
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });

    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    const inlineEditor = await screen.findByTestId("todoist-inline-editor");
    expect(within(inlineEditor).getByTestId("todoist-draft-preview-summary").textContent).toContain("April 22, 2026");
    expect(await screen.findByTestId("calendar-ghost-chip")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-cell-23"));

    await waitFor(() => {
      expect(screen.queryByTestId("todoist-inline-editor")).toBeNull();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    expect(screen.queryByTestId("calendar-ghost-chip")).toBeNull();
    expect(screen.getAllByText("Hero task").length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-cell-23").getAttribute("aria-selected")).toBe("true");
  });
});
