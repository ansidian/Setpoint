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

  it("routes modifier-clicks on timed rows and all-day chips into the Calendar Event Selection Set", () => {
    const toggleEventSelection = vi.fn(() => true);
    const onEventAction = vi.fn();
    renderRail({
      onEventAction,
      events: [
        event({
          id: "timed-event",
          title: "Planning block",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
        }),
        event({
          id: "all-day-event",
          title: "Conference",
          allDay: true,
          start: "2026-05-05T07:00:00.000Z",
          end: "2026-05-06T07:00:00.000Z",
        }),
      ],
      eventQuickActions: {
        isEventSelectionSelected: (candidate) => candidate?.id === "timed-event" || candidate?.id === "all-day-event",
        toggleEventSelection,
      },
    });

    const row = screen.getByTestId("calendar-agenda-event-row");
    const chip = screen.getByTestId("calendar-agenda-event-chip");
    expect(row.getAttribute("data-calendar-event-selection")).toBe("true");
    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(row, { metaKey: true });
    fireEvent.click(chip, { ctrlKey: true });

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "timed-event" }),
      dateKey: "2026-05-04",
      anchorKind: "agenda-row",
    }));
    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "all-day-event" }),
      dateKey: "2026-05-05",
      anchorKind: "agenda-chip",
    }));
    expect(onEventAction).not.toHaveBeenCalled();
  });

  it("renders birthday all-day agenda items as special-date markers that forward modifier-clicks unselected", () => {
    const onEventAction = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    renderRail({
      onEventAction,
      events: [
        event({
          id: "birthday-event",
          title: "Maya's birthday",
          eventType: "birthday",
          birthdayProperties: { type: "birthday" },
          allDay: true,
          writable: false,
          isRecurring: true,
          sourceColor: "#ff887c",
          color: "#ff887c",
          start: "2026-05-05T07:00:00.000Z",
          end: "2026-05-06T07:00:00.000Z",
        }),
      ],
      eventQuickActions: {
        isEventSelectionSelected: () => true,
        toggleEventSelection,
      },
    });

    const chip = screen.getByTestId("calendar-agenda-event-chip");
    expect(chip.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
    expect(chip.textContent).toContain("Maya's birthday");
    expect(chip.textContent).not.toContain("All day");

    fireEvent.click(chip, { metaKey: true });

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "birthday-event" }),
      dateKey: "2026-05-05",
      anchorKind: "agenda-chip",
    }));
    expect(onEventAction).not.toHaveBeenCalled();

    fireEvent.click(chip);

    expect(onEventAction).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "birthday-event" }),
      anchorKind: "agenda-chip",
    }));
    expect(onEventAction.mock.calls[0][0].preserveEventSelection).toBeFalsy();
  });

  it("exposes alternate event ids for agenda reanchoring after saves", () => {
    renderRail({
      selectedDateKey: "2026-05-04",
      events: [
        event({
          id: "provider-id",
          iCalUID: "ical-id",
          htmlLink: "https://calendar.example/event",
          title: "Planning block",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
        }),
      ],
    });

    expect(screen.getByTestId("calendar-agenda-event-row").getAttribute("data-calendar-match-item-ids"))
      .toContain("ical-id");
  });

  it("shows compact reminder timing in agenda rows", () => {
    renderRail({
      selectedDateKey: "2026-05-04",
      events: [
        event({
          id: "event-reminder",
          title: "Planning block",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
          hasUpcomingReminder: true,
          upcomingReminderCount: 1,
          nextReminderAt: "2026-05-04T15:30:00.000Z",
        }),
      ],
    });

    expect(screen.getByTestId("calendar-agenda-reminder-label").textContent).toContain("Reminder");
    expect(screen.getByTestId("calendar-agenda-reminder-label").textContent).toContain("May 4");
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

  it("passively selects the date header tucked under the agenda row offset", async () => {
    const onPassiveDateChange = vi.fn();
    renderRail({
      todayDate: 14,
      selectedDateKey: "2026-05-01",
      entryScrollTargetDateKey: false,
      onPassiveDateChange,
      events: [
        event({
          id: "event-13",
          title: "Previous day",
          start: "2026-05-13T16:00:00.000Z",
          end: "2026-05-13T17:00:00.000Z",
        }),
        event({
          id: "event-14",
          title: "Today planning",
          start: "2026-05-14T16:00:00.000Z",
          end: "2026-05-14T17:00:00.000Z",
        }),
      ],
    });
    const rail = screen.getByTestId("events-agenda-rail");
    const may13Header = screen.getByRole("button", { name: /select wednesday, may 13/i });
    const may14Header = screen.getByRole("button", { name: /select thursday, may 14/i });
    const may13Section = may13Header.closest("section");
    const may14Section = may14Header.closest("section");

    rail.getBoundingClientRect = () => ({ top: 0, bottom: 260, left: 0, right: 280, width: 280, height: 260 });
    may13Section.getBoundingClientRect = () => ({ top: -72, bottom: -4, left: 0, right: 280, width: 280, height: 68 });
    may14Section.getBoundingClientRect = () => ({ top: 10, bottom: 88, left: 0, right: 280, width: 280, height: 78 });

    await act(async () => {
      fireEvent.scroll(rail);
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    expect(onPassiveDateChange).toHaveBeenCalledWith("2026-05-14");
    expect(onPassiveDateChange).not.toHaveBeenCalledWith("2026-05-13");
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

  it("updates the Mini Calendar hover preview immediately as agenda rows change", () => {
    renderRail({
      selectedDateKey: "2026-05-04",
      events: [
        event({
          id: "event-1",
          title: "Planning block",
          color: "#e8776a",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
        }),
        event({
          id: "event-2",
          title: "Review block",
          color: "#89b4fa",
          start: "2026-05-05T16:00:00.000Z",
          end: "2026-05-05T17:00:00.000Z",
        }),
      ],
    });

    const calendar = screen.getByTestId("calendar-mini-calendar");
    const [firstRow, secondRow] = screen.getAllByTestId("calendar-agenda-event-row");
    const mayFour = within(calendar).getByRole("button", { name: /Monday, May 4, selected/i });
    const mayFive = within(calendar).getByRole("button", { name: /Tuesday, May 5/i });

    fireEvent.mouseEnter(firstRow);
    expect(mayFour.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFour.getAttribute("data-date-fill")).toBe("hover-preview");
    expect(mayFour.getAttribute("data-hover-preview-color")).toBe("#e8776a");

    fireEvent.mouseEnter(secondRow);
    expect(mayFive.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFive.getAttribute("data-hover-preview-color")).toBe("#89b4fa");

    fireEvent.mouseLeave(firstRow);
    expect(mayFive.getAttribute("data-hover-preview")).toBe("active");

    fireEvent.mouseLeave(secondRow);
    expect(mayFive.getAttribute("data-hover-preview")).toBeNull();
    expect(mayFour.getAttribute("data-date-fill")).toBe("selected");
  });

  it("previews focused multi-day all-day chips as a continuous Mini Calendar pill", () => {
    renderRail({
      selectedDateKey: "2026-05-01",
      events: [
        event({
          id: "conference",
          title: "Conference",
          allDay: true,
          color: "#a6e3a1",
          start: "2026-05-01T07:00:00.000Z",
          end: "2026-05-11T07:00:00.000Z",
        }),
      ],
    });

    fireEvent.focus(screen.getAllByTestId("calendar-agenda-event-chip")[0]);

    const segments = screen.getAllByTestId("calendar-mini-calendar-hover-preview");
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.getAttribute("data-segment-start"))).toEqual([
      "2026-05-01",
      "2026-05-03",
      "2026-05-10",
    ]);
    expect(segments.every((segment) => segment.getAttribute("data-preview-color") === "#a6e3a1")).toBe(true);
  });

  it("derives Mini Calendar deadline markers from the filtered deadline overlay", () => {
    const deadlineData = {
      upcoming: [
        { id: "active", title: "Active", due_date: "2026-05-12", source: "todoist", status: "incomplete" },
        { id: "done", title: "Done", due_date: "2026-05-12", source: "todoist", status: "complete" },
      ],
    };
    const { rerender } = renderRail({
      selectedDateKey: "2026-05-12",
      deadlineOverlay: { showCompleted: false, data: deadlineData },
    });
    const calendar = screen.getByTestId("calendar-mini-calendar");
    const mayTwelve = within(calendar).getByRole("button", { name: /Tuesday, May 12, selected/i });
    let deadlineMarker = within(mayTwelve).getByTestId("calendar-mini-calendar-marker");

    expect(deadlineMarker.getAttribute("data-marker-kind")).toBe("deadline");
    expect(deadlineMarker.getAttribute("data-marker-count")).toBe("1");

    rerender(
      <EventsAgendaRail
        viewYear={2026}
        viewMonth={4}
        currentYear={2026}
        currentMonth={4}
        todayDate={1}
        selectedDateKey="2026-05-12"
        events={[
          event({
            id: "event-1",
            title: "Planning block",
            start: "2026-05-04T16:00:00.000Z",
            end: "2026-05-04T17:00:00.000Z",
          }),
        ]}
        deadlineOverlay={{ showCompleted: true, data: deadlineData }}
      />,
    );

    deadlineMarker = within(within(screen.getByTestId("calendar-mini-calendar"))
      .getByRole("button", { name: /Tuesday, May 12, selected/i }))
      .getByTestId("calendar-mini-calendar-marker");
    expect(deadlineMarker.getAttribute("data-marker-kind")).toBe("deadline");
    expect(deadlineMarker.getAttribute("data-marker-count")).toBe("2");
  });

  it("shows markers for trailing Mini Calendar dates while viewing the current month", () => {
    renderRail({
      selectedDateKey: "2026-05-04",
      events: [
        event({
          id: "event-1",
          title: "Planning block",
          start: "2026-05-04T16:00:00.000Z",
          end: "2026-05-04T17:00:00.000Z",
        }),
        event({
          id: "june-event",
          title: "June kickoff",
          color: "#a6e3a1",
          start: "2026-06-01T16:00:00.000Z",
          end: "2026-06-01T17:00:00.000Z",
        }),
      ],
      deadlineOverlay: {
        showCompleted: true,
        data: {
          upcoming: [
            { id: "june-deadline", title: "June task", due_date: "2026-06-01", source: "todoist", status: "incomplete" },
          ],
        },
      },
    });

    const juneOne = within(screen.getByTestId("calendar-mini-calendar"))
      .getByRole("button", { name: /Monday, June 1/i });
    expect(juneOne.getAttribute("data-adjacent-position")).toBe("trailing");

    const markers = within(juneOne).getAllByTestId("calendar-mini-calendar-marker");
    expect(markers.map((marker) => marker.getAttribute("data-marker-kind"))).toEqual([
      "dot",
      "deadline",
    ]);
    expect(markers.map((marker) => marker.getAttribute("data-marker-color"))).toEqual([
      "#a6e3a1",
      "#e44332",
    ]);
  });

  it("previews focused deadline rows with their source color", () => {
    renderRail({
      selectedDateKey: "2026-05-12",
      events: [],
      deadlineOverlay: {
        showCompleted: true,
        data: {
          upcoming: [
            { id: "deadline-1", title: "Submit report", due_date: "2026-05-12", source: "todoist", status: "incomplete" },
          ],
        },
      },
    });

    fireEvent.focus(screen.getByTestId("calendar-agenda-deadline-row"));

    const mayTwelve = within(screen.getByTestId("calendar-mini-calendar"))
      .getByRole("button", { name: /Tuesday, May 12, selected/i });
    expect(mayTwelve.getAttribute("data-hover-preview")).toBe("active");
    expect(mayTwelve.getAttribute("data-hover-preview-color")).toBe("#e44332");
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
    expect(chips[0].style.border).toBe("1px solid rgba(137, 180, 250, 1)");
    expect(chips[1].style.border).not.toBe("1px solid rgba(137, 180, 250, 1)");
  });

  it("renders the full title in a selected solid all-day chip", () => {
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
    expect(chip.textContent).toContain("Residency planning block with a long stable title");
  });

  it("uses normal sticky headers without terminal scroll affordances", () => {
    renderRail();

    const header = screen.getByRole("button", { name: /select monday, may 4/i });
    expect(header.getAttribute("data-agenda-date-header")).toBe("true");
    expect(screen.queryByTestId("events-agenda-active-header")).toBeNull();
    expect(screen.queryByTestId("events-agenda-terminal-sentinel")).toBeNull();
  });
});
