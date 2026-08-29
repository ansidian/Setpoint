import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventsAgendaRail from "./EventsAgendaRail.tsx";
import type { CalendarItemLike } from "../calendarViewTypes";

afterEach(cleanup);

function event(
  overrides: CalendarItemLike & { id: string; title: string; start: string; end: string },
): CalendarItemLike {
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

describe("EventsAgendaRail durable contracts", () => {
  it("exposes alternate event ids for agenda reanchoring after saves", () => {
    render(
      <EventsAgendaRail
        viewYear={2026}
        viewMonth={4}
        currentYear={2026}
        currentMonth={4}
        todayDate={1}
        selectedDateKey="2026-05-04"
        events={[
          event({
            id: "provider-id",
            iCalUID: "ical-id",
            htmlLink: "https://calendar.example/event",
            title: "Planning block",
            start: "2026-05-04T16:00:00.000Z",
            end: "2026-05-04T17:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("calendar-agenda-event-row").getAttribute("data-calendar-match-item-ids"))
      .toContain("ical-id");
  });
});
