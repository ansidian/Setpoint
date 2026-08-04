import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";
import { getCalendarLayoutMetrics } from "./calendarLayout.ts";
import { getVisibleGridRange } from "./calendarDateUtils.ts";
import { monthBlockHeight, monthIndexToDate } from "../../hooks/calendar/calendarScrollModel";

describe("CalendarModal event grid behavior", () => {
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

  it("builds and clears a Calendar Event Selection Set from modifier-clicked grid chips", async () => {
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
              accountId: "gmail-main",
              calendarId: "primary",
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

    const eventCell = screen.getByTestId("calendar-cell-20");
    const chip = within(eventCell).getByTestId("calendar-cell-item-chip");

    fireEvent.click(chip, { metaKey: true });

    await waitFor(() => {
      expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-cell-21"), { metaKey: true });
    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(screen.getByTestId("calendar-cell-21"));

    await waitFor(() => {
      expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
    });
  });

  it("promotes the focused event into the selection set on bare Meta", async () => {
    window.innerWidth = 1900;
    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([{
            id: "event-1",
            title: "Design review",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
            endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
            allDay: false,
            color: "#4285f4",
            writable: true,
          }]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));
    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Meta" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
      expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
  });

  it("dismisses an identity-less birthday detail on bare Control without touching the selection set", async () => {
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
              accountId: "gmail-main",
              calendarId: "primary",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
            {
              id: "birthday-1",
              title: "Maya's birthday",
              accountId: "gmail-main",
              calendarId: "primary",
              eventType: "birthday",
              startMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T07:00:00.000Z").getTime(),
              allDay: true,
              writable: false,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    const birthdaySpan = screen.getByTestId("calendar-event-span-segment");
    expect(birthdaySpan.textContent).toContain("Maya's birthday");
    fireEvent.click(birthdaySpan);
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Maya's birthday");

    fireEvent.keyDown(document, { key: "Control" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(birthdaySpan.getAttribute("data-calendar-event-selection")).toBeNull();
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
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
      view: "events",
      expectedRailTestId: "events-agenda-rail",
      expectedEmptyText: "No Events",
      billsData: {},
      deadlinesData: { upcoming: [] },
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
      expect(ensureRange.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    });

    const initialCallCount = ensureRange.mock.calls.length;

    rerender(renderModal());
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- This regression protects range-load admission across wrapper identity churn; readiness UI cannot reveal a duplicate cache/fetch admission.
      expect(ensureRange).toHaveBeenCalledTimes(initialCallCount);
      expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
    });
  });

  it("consumes navigation hotkeys without leaving selected items in focus-ring mode", async () => {
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

    const navigationEvent = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    act(() => {
      chip.dispatchEvent(navigationEvent);
    });

    expect(navigationEvent.defaultPrevented).toBe(true);
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
    expect(within(indicator).getByTestId("calendar-pending-update-icon")).toBeTruthy();
  });

  it("keeps loading data for grid settles inside the agenda-sync suppression window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T16:00:00.000Z"));
    try {
      window.innerWidth = 1900;
      const eventsData = {
        editable: true,
        ensureRange: vi.fn().mockResolvedValue([]),
        getEvents: () => [],
        revision: 0,
      };

      function VisibleRangeHarness() {
        const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);
        return wrapWithDashboard(
          <>
            <output data-testid="calendar-observed-visible-range">{JSON.stringify(visibleRange)}</output>
            <CalendarModal
              open
              onClose={() => {}}
              view="events"
              onViewChange={() => {}}
              eventsData={eventsData}
              onEventsVisibleRangeChange={setVisibleRange}
              billsData={{}}
              deadlinesData={{}}
            />
          </>,
        );
      }

      render(<VisibleRangeHarness />);

      const scrollEl = await screen.findByTestId("calendar-scroll-container");
      await waitFor(() => expect(screen.getByTestId("calendar-observed-visible-range").textContent).not.toBe("null"));

      // Chevron navigation to June opens the 900ms grid↔agenda suppression
      // window (the same window agenda-driven scrolling opens).
      fireEvent.click(screen.getByRole("button", { name: "Next month" }));
      await waitFor(() => {
        const { start, end } = getVisibleGridRange(2026, 5);
        expect(screen.getByTestId("calendar-observed-visible-range").textContent).toBe(JSON.stringify({ start, end }));
      });

      // The user grabs the grid inside that window and scrolls on into July.
      // jsdom fires no scroll events for scrollTop writes; dispatch manually.
      const layout = getCalendarLayoutMetrics(1900);
      let julyOffset = 0;
      for (let i = -24; i < 2; i++) {
        const { year, month } = monthIndexToDate(i, 2026, 4);
        julyOffset += monthBlockHeight({
          year,
          month,
          cellHeight: layout.cellHeight,
          gridGap: layout.gridGap,
        });
      }
      scrollEl.scrollTop = julyOffset + 10;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));

      // The settle must still move the fetch anchor: data loading follows the
      // settled month even while agenda rail re-targeting stays suppressed.
      await waitFor(() => {
        const { start, end } = getVisibleGridRange(2026, 6);
        expect(screen.getByTestId("calendar-observed-visible-range").textContent).toBe(JSON.stringify({ start, end }));
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
