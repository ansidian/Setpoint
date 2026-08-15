import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { flushAnimationFrame, pointerClick, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";
import type { CalendarEventCreateRequest } from "../../hooks/calendar/calendarEventCreateBridge.ts";
import { mockCreateCalendarEvent } from "./CalendarModal.test-setup.ts";

function eventCreateRequest(onAcknowledged = vi.fn()): CalendarEventCreateRequest {
  return {
    seed: {
      title: "Seeded planning",
      allDay: false,
      startDate: "2026-09-10",
      startTime: "14:00",
      endTime: "14:30",
      location: "Ops room",
      description: "Review metrics",
    },
    origin: { kind: "test", referenceId: "request-1" },
    onAcknowledged,
  };
}

// These workspace flows wait on multi-step rAF parking cycles (1.5-2.7s each in
// isolation); the global 10s testTimeout flakes under full-suite worker load.
vi.setConfig({ testTimeout: 20000 });

describe("CalendarModal floating event create workspace behavior", () => {
  it("acknowledges an initial seeded request once and does not replay it on a later manual create", async () => {
    window.innerWidth = 1900;
    const onAcknowledged = vi.fn();
    const request = eventCreateRequest(onAcknowledged);
    const baseProps = {
      open: true,
      onClose: () => {},
      view: "events",
      onViewChange: () => {},
      eventsData: { editable: true, getEvents: () => [] },
      billsData: {},
      deadlinesData: {},
    };

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={1}
        focusItemId="new"
        focusDate="2026-09-10"
        eventCreateRequest={request}
      />,
    ));
    await flushAnimationFrame();

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Acknowledgement is the controller's outbound request-owner contract; editor rendering cannot prove exactly-once delivery.
      expect(onAcknowledged).toHaveBeenCalledTimes(1);
      // test-architecture: allow-boundary-interaction -- The request owner must receive the unchanged origin after the real editor accepts the seed.
      expect(onAcknowledged).toHaveBeenCalledWith({ status: "accepted", origin: request.origin });
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value).toBe("Seeded planning");
      expect(screen.getByTestId("calendar-ghost-chip")).toBeTruthy();
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-anchor-kind")).toBe("chip");
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull());

    rerender(wrapWithDashboard(
      <CalendarModal
        {...baseProps}
        openRequestId={2}
        focusItemId="new"
        focusDate="2026-09-11"
      />,
    ));
    await flushAnimationFrame();

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value).toBe("");
    });
    // test-architecture: allow-boundary-interaction -- Reopening Calendar must not redeliver the already-consumed external acknowledgement.
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
  });

  it("fails acknowledgement without opening a floating shell when the editor is unavailable", async () => {
    window.innerWidth = 1900;
    const onAcknowledged = vi.fn();
    const request = eventCreateRequest(onAcknowledged);

    render(wrapWithDashboard(
      <CalendarModal
        open
        view="events"
        onViewChange={() => {}}
        openRequestId={1}
        focusItemId="new"
        focusDate="2026-09-10"
        eventCreateRequest={request}
        eventsData={{ editable: false, getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));
    await flushAnimationFrame();

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Unavailable-editor failure is observable only through the request-owner acknowledgement boundary.
      expect(onAcknowledged).toHaveBeenCalledTimes(1);
      // test-architecture: allow-boundary-interaction -- The failure boundary must preserve origin and expose the controller-owned reason.
      expect(onAcknowledged).toHaveBeenCalledWith({
        status: "failed",
        origin: request.origin,
        reason: "calendar_unavailable",
      });
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
  });

  it("preserves save-to-detail routing and completes with the normalized event once", async () => {
    window.innerWidth = 1900;
    const onCompleted = vi.fn();
    const request = eventCreateRequest();
    request.onCompleted = onCompleted;
    const savedEvent = {
      id: "saved-seeded-event",
      etag: '"saved"',
      title: "Seeded planning",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-09-10T21:00:00.000Z").getTime(),
      endMs: new Date("2026-09-10T21:30:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({ event: savedEvent });

    render(wrapWithDashboard(
      <CalendarModal
        open
        view="events"
        onViewChange={() => {}}
        openRequestId={1}
        focusItemId="new"
        focusDate="2026-09-10"
        eventCreateRequest={request}
        eventsData={{ editable: true, getEvents: () => [], upsertEvents: () => {} }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));
    await flushAnimationFrame();
    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("calendar-event-save"));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Completion cardinality is an outbound bridge guarantee not represented by the saved detail UI.
      expect(onCompleted).toHaveBeenCalledTimes(1);
      // test-architecture: allow-boundary-interaction -- Completion must return the exact normalized event and unchanged origin across the caller boundary.
      expect(onCompleted).toHaveBeenCalledWith({ event: savedEvent, origin: request.origin });
      expect(screen.getByTestId("calendar-floating-detail-panel").getAttribute("data-floating-mode"))
        .toBe("detail");
    });
  });

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
