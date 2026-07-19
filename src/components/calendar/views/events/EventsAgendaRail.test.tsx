import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsAgendaRail from "./EventsAgendaRail.tsx";
import type { ComponentProps } from "react";
import type { CalendarItemLike } from "../calendarViewTypes";

const asRect = (value: Omit<DOMRect, "x" | "y" | "toJSON">): DOMRect => value as DOMRect;

afterEach(() => {
  cleanup();
});

function event(overrides: CalendarItemLike & { id: string; title: string; start: string; end: string }): CalendarItemLike {
  return Object.assign({
    id: overrides.id,
    title: overrides.title,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end).getTime(),
    allDay: false,
    writable: true,
    color: "#89b4fa",
  }, overrides);
}

function renderRail(props: Partial<ComponentProps<typeof EventsAgendaRail>> = {}) {
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
    expect(onEventAction.mock.calls[0]![0]!.preserveEventSelection).toBeFalsy();
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

    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 240, left: 0, right: 280, width: 280, height: 240 });
    may1Header.getBoundingClientRect = () => asRect({ top: -48, bottom: -14, left: 0, right: 280, width: 280, height: 34 });
    may4Header.getBoundingClientRect = () => asRect({ top: 2, bottom: 36, left: 0, right: 280, width: 280, height: 34 });

    await act(async () => {
      fireEvent.pointerDown(row);
      fireEvent.scroll(rail);
      await new Promise<void>((resolve) => {
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
    const may13Section = may13Header.closest("section")!;
    const may14Section = may14Header.closest("section")!;

    rail.getBoundingClientRect = () => asRect({ top: 0, bottom: 260, left: 0, right: 280, width: 280, height: 260 });
    may13Section.getBoundingClientRect = () => asRect({ top: -72, bottom: -4, left: 0, right: 280, width: 280, height: 68 });
    may14Section.getBoundingClientRect = () => asRect({ top: 10, bottom: 88, left: 0, right: 280, width: 280, height: 78 });

    await act(async () => {
      fireEvent.scroll(rail);
      await new Promise<void>((resolve) => {
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

  it("keeps mobile and desktop empty-month content distinct", () => {
    renderRail({
      events: [],
      currentMonth: 3,
      selectedDateKey: null,
      mobileAgenda: true,
    });

    expect(screen.getByText("Nothing scheduled in May")).toBeTruthy();
    expect(screen.getByText("Days you add will appear here.")).toBeTruthy();
    expect(screen.queryByText("No Events")).toBeNull();

    cleanup();
    renderRail({
      events: [],
      currentMonth: 3,
      selectedDateKey: null,
    });

    expect(screen.getByText("No Events")).toBeTruthy();
    expect(screen.queryByText(/Nothing scheduled in/)).toBeNull();
    expect(screen.queryByText("Days you add will appear here.")).toBeNull();
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

    fireEvent.mouseEnter(firstRow!);
    expect(mayFour.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFour.getAttribute("data-date-fill")).toBe("hover-preview");
    expect(mayFour.getAttribute("data-hover-preview-color")).toBe("#e8776a");

    fireEvent.mouseEnter(secondRow!);
    expect(mayFive.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFive.getAttribute("data-hover-preview-color")).toBe("#89b4fa");

    fireEvent.mouseLeave(firstRow!);
    expect(mayFive.getAttribute("data-hover-preview")).toBe("active");

    fireEvent.mouseLeave(secondRow!);
    expect(mayFive.getAttribute("data-hover-preview")).toBeNull();
    expect(mayFour.getAttribute("data-date-fill")).toBe("selected");
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

  it("renders the Mini Calendar by default and suppresses it for mobile", () => {
    renderRail();
    expect(screen.getByTestId("calendar-mini-calendar")).toBeTruthy();

    cleanup();
    renderRail({ hideMiniCalendar: true });
    expect(screen.queryByTestId("calendar-mini-calendar")).toBeNull();
    expect(screen.getByTestId("events-agenda-rail")).toBeTruthy();
  });
});
