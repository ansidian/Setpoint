import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsAgendaRail from "./EventsAgendaRail.jsx";

afterEach(() => {
  cleanup();
});

function event(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end).getTime(),
    allDay: false,
    writable: true,
    color: "#89b4fa",
    ...overrides,
  };
}

function renderRail(props = {}) {
  return render(
    <EventsAgendaRail
      viewYear={2026}
      viewMonth={4}
      currentYear={2026}
      currentMonth={4}
      todayDate={1}
      events={[
        event({
          id: "event-1",
          title: "Planning block",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
        }),
      ]}
      {...props}
    />,
  );
}

describe("EventsAgendaRail", () => {
  it("opens agenda rows through the event action contract", () => {
    const onEventAction = vi.fn();
    renderRail({ selectedDateKey: "2026-05-04", onEventAction });

    fireEvent.click(screen.getByTestId("calendar-agenda-event-row"));

    expect(onEventAction).toHaveBeenCalledWith(expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "agenda-row",
      event: expect.objectContaining({
        id: "event-1",
        agendaTitle: "Planning block",
        agendaItemId: "event-1",
      }),
    }));
  });

  it("opens the event context menu from agenda row right-click", () => {
    const openContextMenu = vi.fn(() => true);
    renderRail({
      selectedDateKey: "2026-05-04",
      eventQuickActions: { openContextMenu },
    });

    fireEvent.contextMenu(screen.getByTestId("calendar-agenda-event-row"), {
      clientX: 120,
      clientY: 160,
    });

    expect(openContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "event-1" }),
      x: 120,
      y: 160,
    }));
  });

  it("keeps the agenda skeleton until entry scroll content is ready", () => {
    const { rerender } = renderRail({
      selectedDateKey: "2026-05-04",
      entryScrollReady: false,
    });

    expect(screen.getByTestId("calendar-events-rail-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("events-agenda-rail")).toBeNull();

    rerender(
      <EventsAgendaRail
        viewYear={2026}
        viewMonth={4}
        currentYear={2026}
        currentMonth={4}
        todayDate={1}
        selectedDateKey="2026-05-04"
        entryScrollReady
        events={[
          event({
            id: "event-1",
            title: "Planning block",
            start: "2026-05-04T16:00:00.000Z",
            end: "2026-05-04T17:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId("calendar-events-rail-skeleton")).toBeNull();
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
  });

  it("selects date headers without opening an event or moving the agenda rail", () => {
    const onDateAction = vi.fn();
    const onEventAction = vi.fn();
    renderRail({ onDateAction, onEventAction });
    const rail = screen.getByTestId("events-agenda-rail");
    const scrollTo = vi.fn();
    rail.scrollTo = scrollTo;
    rail.scrollTop = 88;

    fireEvent.click(screen.getByRole("button", { name: /select monday, may 4/i }));

    expect(onDateAction).toHaveBeenCalledWith("2026-05-04");
    expect(onEventAction).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(rail.scrollTop).toBe(88);
  });

  it("suppresses passive date sync for pointer-induced item scroll", async () => {
    const onPassiveDateChange = vi.fn();
    renderRail({ selectedDateKey: "2026-05-01", onPassiveDateChange });
    const rail = screen.getByTestId("events-agenda-rail");
    const may1Header = screen.getByRole("button", { name: /select friday, may 1/i });
    const may4Header = screen.getByRole("button", { name: /select monday, may 4/i });
    const row = screen.getByTestId("calendar-agenda-event-row");

    rail.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    may1Header.getBoundingClientRect = () => ({ top: -48, bottom: -14, left: 0, right: 280, width: 280, height: 34 });
    may4Header.getBoundingClientRect = () => ({ top: 2, bottom: 36, left: 0, right: 280, width: 280, height: 34 });

    await act(async () => {
      fireEvent.pointerDown(row);
      fireEvent.scroll(rail);
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    expect(onPassiveDateChange).not.toHaveBeenCalled();
  });

  it("pre-selects the month-start anchor on month entry", async () => {
    const onPassiveDateChange = vi.fn();
    renderRail({
      currentMonth: 3,
      todayDate: 30,
      selectedDateKey: null,
      onPassiveDateChange,
    });

    await waitFor(() => {
      expect(onPassiveDateChange).toHaveBeenCalledWith("2026-05-01");
    });
  });

  it("shows No Events for a selected empty date anchor", () => {
    renderRail({ selectedDateKey: "2026-05-01", onCreateEvent: vi.fn() });

    expect(screen.getByRole("button", { name: /select friday, may 1/i })).toBeTruthy();
    expect(screen.getByText("No Events")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create event/i })).toBeNull();
  });

  it("renders today's header and empty target when today has no events", () => {
    renderRail({
      todayDate: 2,
      selectedDateKey: "2026-05-04",
    });

    expect(screen.getByRole("button", { name: /select saturday, may 2/i })).toBeTruthy();
    expect(screen.getByText("TODAY 5/2/26")).toBeTruthy();
    expect(screen.getByText("No Events")).toBeTruthy();
  });

  it("renders weather-only forecast days and collapsed all-day overflow", () => {
    renderRail({
      events: [
        event({ id: "a", title: "A", allDay: true, start: "2026-05-05T07:00:00.000Z", end: "2026-05-06T07:00:00.000Z" }),
        event({ id: "b", title: "B", allDay: true, start: "2026-05-05T07:00:00.000Z", end: "2026-05-06T07:00:00.000Z" }),
        event({ id: "c", title: "C", allDay: true, start: "2026-05-05T07:00:00.000Z", end: "2026-05-06T07:00:00.000Z" }),
      ],
      weatherData: {
        dailyForecast: [{ dateKey: "2026-05-06", high: 72, low: 55, icon: "Sun" }],
      },
    });

    const rail = screen.getByTestId("events-agenda-rail");
    expect(within(rail).getAllByText("TUESDAY 5/5/26").length).toBeGreaterThan(0);
    expect(within(rail).getByText("+1")).toBeTruthy();
    expect(within(rail).getByText("WEDNESDAY 5/6/26")).toBeTruthy();
    expect(within(rail).getByText("72°/55°")).toBeTruthy();
  });

  it("scopes visual selection to the selected agenda date for multi-day events", () => {
    renderRail({
      selectedDateKey: "2026-05-05",
      selectedItemId: "multi-day",
      events: [
        event({
          id: "multi-day",
          title: "Residency",
          allDay: true,
          start: "2026-05-05T07:00:00.000Z",
          end: "2026-05-07T07:00:00.000Z",
        }),
      ],
    });

    const chips = screen.getAllByTestId("calendar-agenda-event-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].style.border).toBe("1px solid rgb(137, 180, 250)");
    expect(chips[1].style.border).not.toBe("1px solid rgb(137, 180, 250)");
  });

  it("does not insert a selected-only dot into solid all-day chips", () => {
    renderRail({
      selectedDateKey: "2026-05-05",
      selectedItemId: "all-day",
      events: [
        event({
          id: "all-day",
          title: "Residency planning block with a long stable title",
          allDay: true,
          color: "#89b4fa",
          start: "2026-05-05T07:00:00.000Z",
          end: "2026-05-06T07:00:00.000Z",
        }),
      ],
    });

    const chip = screen.getByTestId("calendar-agenda-event-chip");
    expect(chip.querySelector("span[aria-hidden='true']")).toBeNull();
    expect(chip.textContent).toContain("Residency planning block with a long stable title");
  });

  it("uses normal sticky headers without terminal scroll affordances", () => {
    renderRail();

    const header = screen.getByRole("button", { name: /select monday, may 4/i });
    expect(header.getAttribute("data-agenda-date-header")).toBe("true");
    expect(header.style.position).toBe("sticky");
    expect(screen.queryByTestId("events-agenda-active-header")).toBeNull();
    expect(screen.queryByTestId("events-agenda-terminal-sentinel")).toBeNull();
  });
});
