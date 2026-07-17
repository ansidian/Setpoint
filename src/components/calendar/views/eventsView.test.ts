import { describe, it, expect } from "vitest";
import eventsView from "./eventsView.tsx";
import type { CalendarItemLike } from "./calendarViewTypes";

function ev({ iso, title, color = "#4285f4", source = "gmail", endIso = null, allDay = false, id = title }: {
  iso: string;
  title: string;
  color?: string;
  source?: string;
  endIso?: string | null;
  allDay?: boolean;
  id?: string;
}): CalendarItemLike {
  return {
    id,
    startMs: new Date(iso).getTime(),
    endMs: endIso ? new Date(endIso).getTime() : new Date(iso).getTime() + 30 * 60000,
    title,
    color,
    source,
    allDay,
  };
}

describe("eventsView.compute", () => {
  it("buckets events by Pacific day-of-month", () => {
    const { itemsByDay } = eventsView.compute({
      data: {
        events: [
          ev({ iso: "2026-04-20T19:00:00Z", title: "10am PT Apr 20" }),
          ev({ iso: "2026-04-20T04:00:00Z", title: "9pm PT Apr 19" }), // previous PT day
        ],
      },
      viewYear: 2026,
      viewMonth: 3, // April
    });
    expect(itemsByDay[20]?.map((e) => e.title)).toEqual(["10am PT Apr 20"]);
    expect(itemsByDay[19]?.map((e) => e.title)).toEqual(["9pm PT Apr 19"]);
  });

  it("ignores events outside the viewed month", () => {
    const { itemsByDay } = eventsView.compute({
      data: {
        events: [
          ev({ iso: "2026-03-15T19:00:00Z", title: "prev month" }),
          ev({ iso: "2026-05-01T19:00:00Z", title: "next month" }),
          ev({ iso: "2026-04-10T19:00:00Z", title: "this month" }),
        ],
      },
      viewYear: 2026,
      viewMonth: 3,
    });
    expect(Object.keys(itemsByDay)).toEqual(["10"]);
  });

  it("returns empty itemsByDay when data is missing", () => {
    const { itemsByDay } = eventsView.compute({
      data: null,
      viewYear: 2026,
      viewMonth: 3,
    });
    expect(itemsByDay).toEqual({});
  });

  it("returns empty itemsByDay when events array is missing", () => {
    const { itemsByDay } = eventsView.compute({
      data: {},
      viewYear: 2026,
      viewMonth: 3,
    });
    expect(itemsByDay).toEqual({});
  });

  it("expands pinned spanning events onto continuation dates without double-counting totals", () => {
    const span = ev({
      id: "span",
      iso: "2026-04-30T07:00:00Z",
      endIso: "2026-05-03T07:00:00Z",
      title: "Conference",
      allDay: true,
    });
    const { itemsByDay, itemsByDate, totalEvents, allDayEvents } = eventsView.compute({
      data: { events: [span] },
      viewYear: 2026,
      viewMonth: 3,
    });

    expect(itemsByDay[30]).toEqual([span]);
    expect(itemsByDate["2026-05-01"]!).toEqual([span]);
    expect(totalEvents).toBe(1);
    expect(allDayEvents).toBe(1);
  });

  it("sorts detail items with all-day entries before timed entries on continuation dates", () => {
    const allDay = ev({
      id: "all-day",
      iso: "2026-04-20T07:00:00Z",
      endIso: "2026-04-22T07:00:00Z",
      title: "All-day hold",
      allDay: true,
    });
    const timed = ev({
      id: "timed",
      iso: "2026-04-21T05:00:00Z",
      endIso: "2026-04-21T08:00:00Z",
      title: "Late work",
    });

    const { itemsByDate } = eventsView.compute({
      data: { events: [timed, allDay] },
      viewYear: 2026,
      viewMonth: 3,
    });

    expect(itemsByDate["2026-04-20"]!.map((event) => event.title)).toEqual([
      "All-day hold",
      "Late work",
    ]);
  });
});

describe("eventsView.canNavigateBack", () => {
  it("allows navigating to earlier months from the current month", () => {
    expect(
      eventsView.canNavigateBack({
        viewYear: 2026,
        viewMonth: 3,
        currentYear: 2026,
        currentMonth: 3,
        data: { events: [] },
        computed: { itemsByDay: {} },
      }),
    ).toBe(true);
  });
});

describe("eventsView.getVisibleEventCount", () => {
  it("uses stable tier-based capacity for regular and overflow states", () => {
    expect(eventsView.getVisibleEventCount(4, { tier: "lg" })).toBe(4);
    expect(eventsView.getVisibleEventCount(5, { tier: "lg" })).toBe(3);
  });

  it("allows denser xl cells without measuring rendered height", () => {
    expect(eventsView.getVisibleEventCount(6, { tier: "xl" })).toBe(6);
    expect(eventsView.getVisibleEventCount(7, { tier: "xl" })).toBe(5);
  });

  it("uses the 4K uhd tier for high-density event cells", () => {
    expect(eventsView.getVisibleEventCount(11, { tier: "uhd" })).toBe(11);
    expect(eventsView.getVisibleEventCount(12, { tier: "uhd" })).toBe(10);
  });
});

describe("eventsView weather cell metadata", () => {
  it("maps daily forecast data by date for event calendar cells", () => {
    const { cellMetaByDate } = eventsView.compute({
      data: { events: [] },
      viewYear: 2026,
      viewMonth: 3,
      weatherData: {
        dailyForecast: [
          { dateKey: "2026-04-20", high: 72, low: 55, icon: "Sun", summary: "Sunny" },
          { dateKey: "2026-04-21", high: 68, low: 52, icon: "Cloud", summary: "Cloudy" },
        ],
      },
    });

    expect(cellMetaByDate["2026-04-20"]!.weather).toEqual({
      dateKey: "2026-04-20",
      high: 72,
      low: 55,
      icon: "Sun",
      summary: "Sunny",
    });
    expect(cellMetaByDate["2026-04-22"]!).toBeUndefined();
  });
});
