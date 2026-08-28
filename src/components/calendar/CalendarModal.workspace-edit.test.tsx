import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, pointerClick, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

// These workspace flows wait on multi-step rAF parking cycles (1.5-2.7s each in
// isolation); the global 10s testTimeout flakes under full-suite worker load.
vi.setConfig({ testTimeout: 20000 });

describe("CalendarModal floating event edit workspace behavior", () => {

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

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
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
    fireEvent.click(scheduleTrigger!);
    expect(await screen.findByTestId("calendar-compact-schedule-picker")).toBeTruthy();

    const headerNextButton = screen.getAllByRole("button", { name: /next month/i })
      .find((btn) => btn.getAttribute("data-calendar-month-navigation") === "true");
    fireEvent.click(headerNextButton!);

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
    });
    expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
    expect(screen.getByDisplayValue("Design review revised")).toBeTruthy();

    const headerPrevButton = screen.getAllByRole("button", { name: /previous month/i })
      .find((btn) => btn.getAttribute("data-calendar-month-navigation") === "true");
    fireEvent.click(headerPrevButton!);

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode")).toBe("edit");
    });
    expect(screen.getByDisplayValue("Design review revised")).toBeTruthy();
  });

});
