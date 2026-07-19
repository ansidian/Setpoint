import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, pointerClick, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

// These workspace flows wait on multi-step rAF parking cycles (1.5-2.7s each in
// isolation); the global 10s testTimeout flakes under full-suite worker load.
vi.setConfig({ testTimeout: 20000 });

describe("CalendarModal floating event create workspace behavior", () => {
  it("opens the create event form from c and preserves the selected day seed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
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

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

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
});
