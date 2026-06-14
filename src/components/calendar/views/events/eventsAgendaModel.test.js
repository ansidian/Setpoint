import { describe, expect, it } from "vitest";
import { buildEventsAgendaGroups, buildMultiMonthAgendaGroups, formatAgendaHeaderLabel, reuseMultiMonthAgendaGroups } from "./eventsAgendaModel.js";

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

  it("renders a first-day placeholder when the month has no visible rows", () => {
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

  it("carries deadline status metadata for Events agenda rows", () => {
    const agenda = buildEventsAgendaGroups({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-01",
      events: [],
      deadlineOverlay: {
        showCompleted: true,
        data: {
          upcoming: [
            {
              id: "todo-progress",
              title: "Draft essay",
              due_date: "2026-05-12",
              status: "in_progress",
            },
            {
              id: "todo-1",
              title: "Submit report",
              due_date: "2026-05-12",
              status: "complete",
            },
          ],
        },
      },
    });

    expect(agenda.visibleGroups.find((group) => group.dateKey === "2026-05-12")?.deadlines).toEqual([
      expect.objectContaining({
        agendaItemId: "deadline:todo-progress:2026-05-12",
        agendaSubtitle: "Deadline",
        agendaTimeRange: "Deadline",
        agendaStatus: "In progress",
        agendaStatusIcon: "in_progress",
        agendaComplete: false,
      }),
      expect.objectContaining({
        agendaItemId: "deadline:todo-1:2026-05-12",
        agendaSubtitle: "Deadline",
        agendaTimeRange: "Deadline",
        agendaStatus: "Complete",
        agendaStatusIcon: "complete",
        agendaComplete: true,
      }),
    ]);
  });

  it("formats yesterday, today, tomorrow, and weekday headers", () => {
    expect(formatAgendaHeaderLabel("2026-05-09", "2026-05-10")).toBe("YESTERDAY 5/9/26");
    expect(formatAgendaHeaderLabel("2026-05-10", "2026-05-10")).toBe("TODAY 5/10/26");
    expect(formatAgendaHeaderLabel("2026-05-11", "2026-05-10")).toBe("TOMORROW 5/11/26");
    expect(formatAgendaHeaderLabel("2026-05-12", "2026-05-10")).toBe("TUESDAY 5/12/26");
  });
});

describe("buildMultiMonthAgendaGroups", () => {
  it("builds groups for multiple months in order", () => {
    const result = buildMultiMonthAgendaGroups({
      months: [
        { year: 2026, month: 4 },
        { year: 2026, month: 5 },
      ],
      events: [
        event({ id: "may", title: "May event", start: "2026-05-10T16:00:00Z", end: "2026-05-10T17:00:00Z" }),
        event({ id: "jun", title: "Jun event", start: "2026-06-15T16:00:00Z", end: "2026-06-15T17:00:00Z" }),
      ],
      todayKey: "2026-05-10",
    });

    expect(result).toHaveLength(2);
    expect(result[0].monthKey).toBe("2026-05");
    expect(result[1].monthKey).toBe("2026-06");
    expect(result[0].year).toBe(2026);
    expect(result[0].month).toBe(4);
    expect(result[1].year).toBe(2026);
    expect(result[1].month).toBe(5);
  });

  it("empty months produce a fallback header group", () => {
    const result = buildMultiMonthAgendaGroups({
      months: [{ year: 2026, month: 6 }],
      events: [],
      todayKey: "2026-05-10",
    });

    expect(result).toHaveLength(1);
    expect(result[0].visibleGroups).toHaveLength(1);
    expect(result[0].visibleGroups[0]).toMatchObject({
      dateKey: "2026-07-01",
      isFallback: true,
    });
  });

  it("distributes deadline overlay across months correctly", () => {
    const result = buildMultiMonthAgendaGroups({
      months: [
        { year: 2026, month: 4 },
        { year: 2026, month: 5 },
      ],
      events: [],
      deadlineOverlay: {
        showCompleted: true,
        data: {
          upcoming: [
            { id: "d1", title: "May deadline", due_date: "2026-05-15", status: "in_progress" },
            { id: "d2", title: "Jun deadline", due_date: "2026-06-10", status: "in_progress" },
          ],
        },
      },
      todayKey: "2026-05-10",
    });

    const mayDeadlines = result[0].visibleGroups
      .filter((g) => g.hasDeadlines)
      .flatMap((g) => g.deadlines);
    const junDeadlines = result[1].visibleGroups
      .filter((g) => g.hasDeadlines)
      .flatMap((g) => g.deadlines);

    expect(mayDeadlines).toHaveLength(1);
    expect(mayDeadlines[0].agendaTitle).toBe("May deadline");
    expect(junDeadlines).toHaveLength(1);
    expect(junDeadlines[0].agendaTitle).toBe("Jun deadline");
  });

  it("single-month call matches existing buildEventsAgendaGroups output", () => {
    const params = {
      events: [event({ id: "e1", title: "Test", start: "2026-05-05T10:00:00Z", end: "2026-05-05T11:00:00Z" })],
      todayKey: "2026-05-10",
    };

    const single = buildEventsAgendaGroups({ ...params, viewYear: 2026, viewMonth: 4 });
    const multi = buildMultiMonthAgendaGroups({ ...params, months: [{ year: 2026, month: 4 }] });

    expect(multi).toHaveLength(1);
    expect(multi[0].visibleGroups.map((g) => g.dateKey)).toEqual(single.visibleGroups.map((g) => g.dateKey));
    expect(multi[0].firstVisibleDateKey).toBe(single.firstVisibleDateKey);
    expect(multi[0].monthStartDateKey).toBe(single.monthStartDateKey);
  });

  it("reuses month group identity when that month's bucket is unchanged", () => {
    const ev = (id, iso) => ({ id, title: id, startMs: new Date(iso).getTime(), endMs: new Date(iso).getTime() + 3600000 });
    const buckets = new Map([
      ["2026-06", [ev("june-1", "2026-06-10T18:00:00Z")]],
      ["2026-07", [ev("july-1", "2026-07-12T18:00:00Z")]],
    ]);
    const getMonthEvents = (year, month) => buckets.get(`${year}-${String(month + 1).padStart(2, "0")}`) || [];
    const months = [{ year: 2026, month: 5 }, { year: 2026, month: 6 }];
    const args = { months, getMonthEvents, todayKey: "2026-06-11" };

    const first = reuseMultiMonthAgendaGroups({ previous: null, ...args });
    const second = reuseMultiMonthAgendaGroups({ previous: first.cache, ...args });
    expect(second.list[0]).toBe(first.list[0]);
    expect(second.list[1]).toBe(first.list[1]);

    buckets.set("2026-07", [ev("july-2", "2026-07-20T18:00:00Z")]);
    const third = reuseMultiMonthAgendaGroups({ previous: second.cache, ...args });
    expect(third.list[0]).toBe(second.list[0]);
    expect(third.list[1]).not.toBe(second.list[1]);
    expect(third.list[1].visibleGroups.some((g) => g.dateKey === "2026-07-20")).toBe(true);
  });

  it("invalidates only the month containing a changed forceVisibleDateKey", () => {
    const getMonthEvents = () => [];
    const months = [{ year: 2026, month: 4 }, { year: 2026, month: 5 }];
    const base = { months, getMonthEvents, todayKey: "2026-05-01" };

    const first = reuseMultiMonthAgendaGroups({ previous: null, ...base, forceVisibleDateKey: null });
    const second = reuseMultiMonthAgendaGroups({ previous: first.cache, ...base, forceVisibleDateKey: "2026-06-20" });
    expect(second.list[0]).toBe(first.list[0]);
    expect(second.list[1]).not.toBe(first.list[1]);
    expect(second.list[1].visibleGroups.map((g) => g.dateKey)).toContain("2026-06-20");
  });

  it("applies forceVisibleDateKey only to the containing month", () => {
    const result = buildMultiMonthAgendaGroups({
      months: [
        { year: 2026, month: 4 },
        { year: 2026, month: 5 },
      ],
      events: [],
      todayKey: "2026-04-01",
      forceVisibleDateKey: "2026-06-20",
    });

    const mayDates = result[0].visibleGroups.map((g) => g.dateKey);
    const junDates = result[1].visibleGroups.map((g) => g.dateKey);

    expect(mayDates).not.toContain("2026-06-20");
    expect(junDates).toContain("2026-06-20");
  });
});
