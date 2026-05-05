import { describe, expect, it } from "vitest";
import { buildEventsAgendaGroups, formatAgendaHeaderLabel } from "./eventsAgendaModel.js";

function event(overrides) {
  return {
    id: overrides.id,
    title: overrides.title || "Event",
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end).getTime(),
    allDay: !!overrides.allDay,
    writable: true,
    ...overrides,
  };
}

describe("events agenda model", () => {
  it("keeps the month-start anchor, past event days, and drops other empty no-weather days", () => {
    const agenda = buildEventsAgendaGroups({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-10",
      events: [
        event({
          id: "past",
          title: "Past commitment",
          start: "2026-05-02T16:00:00Z",
          end: "2026-05-02T17:00:00Z",
        }),
      ],
    });

    expect(agenda.visibleGroups.map((group) => group.dateKey)).toEqual(["2026-05-01", "2026-05-02", "2026-05-10"]);
    expect(agenda.visibleGroups[0]).toMatchObject({ dateKey: "2026-05-01", hasEvents: false, isFallback: false });
  });

  it("includes weather-only future forecast days", () => {
    const agenda = buildEventsAgendaGroups({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-10",
      events: [],
      weatherData: {
        dailyForecast: [
          { dateKey: "2026-05-09", high: 70, low: 55, icon: "Sun" },
          { dateKey: "2026-05-11", high: 72, low: 57, icon: "CloudSun" },
        ],
      },
    });

    expect(agenda.visibleGroups.map((group) => group.dateKey)).toEqual(["2026-05-01", "2026-05-10", "2026-05-11"]);
    expect(agenda.visibleGroups[2].weather.high).toBe(72);
  });

  it("renders a first-day fallback when the month has no visible rows", () => {
    const agenda = buildEventsAgendaGroups({
      viewYear: 2026,
      viewMonth: 6,
      todayKey: "2026-05-10",
      events: [],
    });

    expect(agenda.visibleGroups).toHaveLength(1);
    expect(agenda.visibleGroups[0]).toMatchObject({ dateKey: "2026-07-01", isFallback: true });
  });

  it("expands multi-day all-day events into each touched day", () => {
    const agenda = buildEventsAgendaGroups({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-01",
      events: [
        event({
          id: "trip",
          title: "Trip",
          allDay: true,
          start: "2026-05-03T07:00:00Z",
          end: "2026-05-06T07:00:00Z",
        }),
      ],
    });

    expect(agenda.visibleGroups.map((group) => group.dateKey)).toEqual([
      "2026-05-01",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
    ]);
    expect(agenda.visibleGroups.slice(1).every((group) => group.allDay[0].agendaTitle === "Trip")).toBe(true);
  });

  it("formats today, tomorrow, and weekday headers", () => {
    expect(formatAgendaHeaderLabel("2026-05-10", "2026-05-10")).toBe("TODAY 5/10/26");
    expect(formatAgendaHeaderLabel("2026-05-11", "2026-05-10")).toBe("TOMORROW 5/11/26");
    expect(formatAgendaHeaderLabel("2026-05-12", "2026-05-10")).toBe("TUESDAY 5/12/26");
  });
});
