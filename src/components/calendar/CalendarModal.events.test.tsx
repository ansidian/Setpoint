import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";
import { getCalendarLayoutMetrics } from "./calendarLayout.ts";
import { getVisibleGridRange } from "./calendarDateUtils.ts";
import { monthBlockHeight, monthIndexToDate } from "../../hooks/calendar/calendarScrollModel";

const { createCalendarEvent, createCalendarEventsBatch } = await import("@/api");

describe("CalendarModal event grid behavior", () => {
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

  it("renders L-shaped boundary borders on leading boundary row cells", async () => {
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

    const gridShell = screen.getByTestId("calendar-grid-shell");
    expect(within(gridShell).queryByTestId("calendar-month-boundary-overlay")).toBeNull();

    const step = within(gridShell).getByTestId("calendar-boundary-step");
    expect(step).toBeTruthy();

    expect(within(gridShell).queryAllByRole("gridcell")
      .find((el) => el.getAttribute("data-boundary-pass-through") === "true")).toBeUndefined();
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

  it.each([
    ["Meta", { metaKey: true }],
    ["Control", { ctrlKey: true }],
  ])("seeds a selected event chip into the Calendar Event Selection Set when pressing %s", async (key, modifiers) => {
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
              id: "event-2",
              title: "Budget sync",
              accountId: "gmail-main",
              calendarId: "primary",
              startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#cba6da",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const firstChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const secondChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(firstChip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key, ...modifiers });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
      expect(firstChip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");

    fireEvent.click(secondChip, modifiers);

    await waitFor(() => {
      expect(firstChip.getAttribute("data-calendar-event-selection")).toBe("true");
      expect(secondChip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
  });

  it.each([
    ["Meta", { metaKey: true }],
    ["Control", { ctrlKey: true }],
  ])("dismisses the selected birthday detail when pressing %s without starting a selection set", async (key, modifiers) => {
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
              id: "birthday-1",
              title: "Maya's birthday",
              eventType: "birthday",
              birthdayProperties: { type: "birthday" },
              accountId: "gmail-main",
              calendarId: "birthdays",
              startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
              endMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
              allDay: true,
              sourceLabel: "Birthdays",
              color: "#ff887c",
              writable: false,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const chip = await screen.findByTestId("calendar-event-span-segment");
    fireEvent.click(chip, { clientX: 4 });
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key, ...modifiers });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
  });

  it.each([
    ["plain Space", {}],
    ["Control+Space", { ctrlKey: true }],
  ])("does not bind %s as a calendar chip command", async (_label, modifiers) => {
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

    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    chip.focus();

    const spaceEvent = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    act(() => {
      chip.dispatchEvent(spaceEvent);
    });

    expect(spaceEvent.defaultPrevented).toBe(false);
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
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

  it("dismisses the floating detail on modifier-clicked birthday chips without touching the selection set", async () => {
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
    fireEvent.click(birthdaySpan, { metaKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(birthdaySpan.getAttribute("data-calendar-event-selection")).toBeNull();
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
  });

  it("copies the seeded selected event with the Calendar Event Selection Set and clears only the visual set after keyboard paste", async () => {
    window.innerWidth = 1900;
    const clipboard = {
      readText: vi.fn(),
      writeText: vi.fn(),
    };
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    vi.mocked(createCalendarEventsBatch).mockResolvedValue({ created: [], failed: [] });
    const events = [
      {
        id: "event-single-focus",
        title: "Focused single event",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T18:30:00.000Z").getTime(),
        allDay: false,
        color: "#4285f4",
        writable: true,
      },
      {
        id: "event-batch-later",
        title: "Batch later",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
        endMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
        allDay: false,
        color: "#46d6db",
        writable: true,
      },
      {
        id: "event-batch-early",
        title: "Batch early",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T16:30:00.000Z").getTime(),
        allDay: false,
        color: "#46d6db",
        writable: true,
      },
    ];

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          editable: true,
          getEvents: () => events,
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const focusedChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(focusedChip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    const laterChip = within(screen.getByTestId("calendar-cell-22")).getByTestId("calendar-cell-item-chip");
    const earlyChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    expect(laterChip.textContent).toContain("Batch later");
    expect(earlyChip.textContent).toContain("Batch early");
    fireEvent.click(laterChip, { metaKey: true });
    fireEvent.click(earlyChip, { metaKey: true });

    await waitFor(() => {
      expect(focusedChip.getAttribute("data-calendar-event-selection")).toBe("true");
      expect(laterChip.getAttribute("data-calendar-event-selection")).toBe("true");
      expect(earlyChip.getAttribute("data-calendar-event-selection")).toBe("true");
    });

    fireEvent.keyDown(document, { key: "c", metaKey: true });
    fireEvent.keyDown(document, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(createCalendarEventsBatch).toHaveBeenCalledTimes(1);
    });
    expect(createCalendarEventsBatch).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        title: "Focused single event",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
      }),
      expect.objectContaining({
        title: "Batch early",
        startDate: "2026-04-21",
        endDate: "2026-04-21",
      }),
      expect.objectContaining({
        title: "Batch later",
        startDate: "2026-04-22",
        endDate: "2026-04-22",
      }),
    ]);
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(focusedChip.getAttribute("data-calendar-event-selection")).toBeNull();
      expect(laterChip.getAttribute("data-calendar-event-selection")).toBeNull();
      expect(earlyChip.getAttribute("data-calendar-event-selection")).toBeNull();
    });

    fireEvent.keyDown(document, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(createCalendarEventsBatch).toHaveBeenCalledTimes(2);
    });
  });

  it("falls back to the current selected writable event for keyboard copy when the visual selection set is empty", async () => {
    window.innerWidth = 1900;
    vi.mocked(createCalendarEvent).mockResolvedValue({
      event: {
        id: "google-created-single",
        title: "Focused single event",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T18:30:00.000Z").getTime(),
        allDay: false,
        writable: true,
      },
    } as Awaited<ReturnType<typeof createCalendarEvent>>);

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
              id: "event-single-fallback",
              title: "Focused single event",
              accountId: "gmail-main",
              calendarId: "primary",
              startMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:30:00.000Z").getTime(),
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

    fireEvent.keyDown(document, { key: "c", metaKey: true });
    fireEvent.click(screen.getByTestId("calendar-cell-21"));
    fireEvent.keyDown(document, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    });
    expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "Focused single event",
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "11:00",
      endTime: "11:30",
    }));
    expect(createCalendarEventsBatch).not.toHaveBeenCalled();
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
      expect(ensureRange.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    expect(onEventsVisibleRangeChange).toHaveBeenCalledWith({ start: "2026-03-29", end: "2026-05-02" });

    const callCountBeforeRerender = ensureRange.mock.calls.length;

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
      expect(ensureRange).toHaveBeenCalledTimes(callCountBeforeRerender + 1);
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
    expect(indicator.querySelector(".calendar-pending-update-icon")).toBeTruthy();
  });

  it("keeps loading data for grid settles inside the agenda-sync suppression window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T16:00:00.000Z"));
    try {
      window.innerWidth = 1900;
      const onEventsVisibleRangeChange = vi.fn();
      const eventsData = {
        editable: true,
        ensureRange: vi.fn().mockResolvedValue([]),
        getEvents: () => [],
        revision: 0,
      };

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="events"
          onViewChange={() => {}}
          eventsData={eventsData}
          onEventsVisibleRangeChange={onEventsVisibleRangeChange}
          billsData={{}}
          deadlinesData={{}}
        />,
      ));

      const scrollEl = await screen.findByTestId("calendar-scroll-container");
      // Wait out the mount-centering settle so its suppression window closes.
      await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

      // Chevron navigation to June opens the 900ms grid↔agenda suppression
      // window (the same window agenda-driven scrolling opens).
      fireEvent.click(screen.getByRole("button", { name: "Next month" }));
      await waitFor(() => {
        const { start, end } = getVisibleGridRange(2026, 5);
        expect(onEventsVisibleRangeChange).toHaveBeenCalledWith({ start, end });
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
        expect(onEventsVisibleRangeChange).toHaveBeenCalledWith({ start, end });
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
