import { describe, expect, it } from "vitest";
import {
  buildCalendarEventSpanLayout,
  isPinnedCalendarEvent,
  maxSpanLanes,
  spanLaneMetrics,
  visualEventDateRange,
} from "./calendarEventSpanLayout";
import type { CalendarSpanEvent } from "./calendarEventSpanLayout";

function ms(iso: string): number {
  return new Date(iso).getTime();
}

function event(overrides: Partial<CalendarSpanEvent> = {}): CalendarSpanEvent {
  return {
    id: overrides.id || "event-1",
    title: overrides.title || "Event",
    startMs: overrides.startMs ?? ms("2026-04-20T16:00:00Z"),
    endMs: overrides.endMs ?? ms("2026-04-20T17:00:00Z"),
    allDay: !!overrides.allDay,
    writable: overrides.writable ?? true,
    color: overrides.color || "#4285f4",
  };
}

function monthCells(startDate: string, count: number): Array<{ dateKey: string }> {
  const cells: Array<{ dateKey: string }> = [];
  const start = new Date(`${startDate}T12:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    cells.push({ dateKey: date.toISOString().slice(0, 10) });
  }
  return cells;
}

describe("calendarEventSpanLayout visual ranges", () => {
  it("uses exclusive Google end dates for all-day events", () => {
    expect(visualEventDateRange(event({
      allDay: true,
      startMs: ms("2026-04-20T07:00:00Z"),
      endMs: ms("2026-04-23T07:00:00Z"),
    }))).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-22",
    });
  });

  it("keeps timed events ending exactly at local midnight on the start date", () => {
    const midnightEnd = event({
      startMs: ms("2026-04-21T05:00:00Z"),
      endMs: ms("2026-04-21T07:00:00Z"),
    });
    expect(visualEventDateRange(midnightEnd)).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-20",
    });
    expect(isPinnedCalendarEvent(midnightEnd)).toBe(false);
  });

  it("pins timed events that continue past local midnight", () => {
    const crossMidnight = event({
      startMs: ms("2026-04-21T05:00:00Z"),
      endMs: ms("2026-04-21T08:00:00Z"),
    });
    expect(visualEventDateRange(crossMidnight)).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-21",
    });
    expect(isPinnedCalendarEvent(crossMidnight)).toBe(true);
  });
});

describe("buildCalendarEventSpanLayout", () => {
  it("splits spans at visible week-row boundaries", () => {
    const layout = buildCalendarEventSpanLayout({
      monthCells: monthCells("2026-04-26", 14),
      events: [event({
        id: "span",
        allDay: true,
        startMs: ms("2026-04-30T07:00:00Z"),
        endMs: ms("2026-05-05T07:00:00Z"),
      })],
    });

    expect(layout.spanSegments.map((segment) => ({
      row: segment.row,
      columnStart: segment.columnStart,
      columnEnd: segment.columnEnd,
      segmentStart: segment.segmentStart,
      segmentEnd: segment.segmentEnd,
    }))).toEqual([
      { row: 1, columnStart: 5, columnEnd: 8, segmentStart: "2026-04-30", segmentEnd: "2026-05-02" },
      { row: 2, columnStart: 1, columnEnd: 3, segmentStart: "2026-05-03", segmentEnd: "2026-05-04" },
    ]);
  });

  it("assigns overlapping spans to separate row-local lanes", () => {
    const layout = buildCalendarEventSpanLayout({
      monthCells: monthCells("2026-04-19", 14),
      events: [
        event({
          id: "wide",
          title: "Wide",
          allDay: true,
          startMs: ms("2026-04-20T07:00:00Z"),
          endMs: ms("2026-04-26T07:00:00Z"),
        }),
        event({
          id: "overlap",
          title: "Overlap",
          allDay: true,
          startMs: ms("2026-04-21T07:00:00Z"),
          endMs: ms("2026-04-23T07:00:00Z"),
        }),
        event({
          id: "next-row",
          title: "Next row",
          allDay: true,
          startMs: ms("2026-04-27T07:00:00Z"),
          endMs: ms("2026-04-29T07:00:00Z"),
        }),
      ],
    });

    const lanes = Object.fromEntries(layout.spanSegments.map((segment) => [segment.eventId, segment.lane]));
    expect(lanes.wide).toBe(0);
    expect(lanes.overlap).toBe(1);
    expect(lanes["next-row"]).toBe(0);
    expect(layout.reservedLaneCountByDate["2026-04-21"]).toBe(2);
    expect(layout.reservedLaneCountByDate["2026-04-27"]).toBe(1);
  });

  it("normalizes all-day draft ghosts into inert span segments", () => {
    const layout = buildCalendarEventSpanLayout({
      monthCells: monthCells("2026-04-19", 7),
      ghosts: [{
        id: "ghost-1",
        kind: "event",
        title: "Draft hold",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        allDay: true,
        color: "#89b4fa",
      }],
    });

    expect(layout.spanSegments).toHaveLength(1);
    expect(layout.spanSegments[0]).toMatchObject({
      kind: "ghost",
      interactive: false,
      readOnly: true,
      segmentStart: "2026-04-20",
      segmentEnd: "2026-04-20",
    });
    expect(layout.pinnedGhostCountByDate["2026-04-20"]).toBe(1);
  });

  it("keeps timed overnight events out of the pinned layer on their start date", () => {
    const weekSpan = event({
      id: "week-span",
      title: "Week span",
      allDay: true,
      startMs: ms("2026-05-16T07:00:00Z"),
      endMs: ms("2026-05-23T07:00:00Z"),
    });
    const overnight = event({
      id: "overnight",
      title: "Work",
      startMs: ms("2026-05-17T03:15:00Z"),
      endMs: ms("2026-05-17T09:15:00Z"),
    });

    const layout = buildCalendarEventSpanLayout({
      monthCells: monthCells("2026-05-10", 14),
      events: [weekSpan, overnight],
      layout: { tier: "lg", cellHeight: 164 },
    });

    expect(layout.pinnedByDate["2026-05-16"]!.map((item) => item.id)).toEqual(["week-span"]);
    expect(layout.pinnedByDate["2026-05-17"]!.map((item) => item.id)).toEqual(["week-span", "overnight"]);
    expect(layout.spanSegments.find((segment) => (
      segment.eventId === "overnight" && segment.segmentStart <= "2026-05-16"
    ))).toBeUndefined();
  });
});

describe("spanLaneMetrics", () => {
  it("returns default metrics for lg tier", () => {
    const m = spanLaneMetrics({ tier: "lg" });
    expect(m).toEqual({ rowTop: 30, height: 36, gap: 4 });
  });

  it("returns taller rowTop for uhd tier", () => {
    expect(spanLaneMetrics({ tier: "uhd" }).rowTop).toBe(32);
    expect(spanLaneMetrics({ tier: "xl" }).rowTop).toBe(32);
  });
});

describe("maxSpanLanes", () => {
  it("computes lanes that fit within cellHeight", () => {
    expect(maxSpanLanes(164, { tier: "lg" })).toBe(3);
  });

  it("returns 1 when only one lane fits", () => {
    expect(maxSpanLanes(70, { tier: "lg" })).toBe(1);
  });

  it("returns at least 1 even for very small cells", () => {
    expect(maxSpanLanes(30, { tier: "lg" })).toBe(1);
  });
});

describe("span lane capacity overflow", () => {
  it("caps visible segments at maxLanes and routes excess to pinnedOverflowByDate", () => {
    const cells = monthCells("2026-04-19", 7);
    const events = Array.from({ length: 5 }, (_, i) => event({
      id: `ad-${i}`,
      title: `All-day ${i}`,
      allDay: true,
      startMs: ms("2026-04-20T07:00:00Z"),
      endMs: ms("2026-04-21T07:00:00Z"),
    }));

    const layout = buildCalendarEventSpanLayout({
      monthCells: cells,
      events,
      layout: { tier: "lg", cellHeight: 164 },
    });

    const maxLanes = maxSpanLanes(164, { tier: "lg" });
    expect(layout.spanSegments.length).toBe(maxLanes);

    expect(layout.pinnedOverflowByDate["2026-04-20"]).toBeDefined();
    expect(layout.pinnedOverflowByDate["2026-04-20"]!.size).toBe(5 - maxLanes);
  });

  it("caps reservedLaneCountByDate at maxLanes", () => {
    const cells = monthCells("2026-04-19", 7);
    const events = Array.from({ length: 5 }, (_, i) => event({
      id: `ad-${i}`,
      title: `All-day ${i}`,
      allDay: true,
      startMs: ms("2026-04-20T07:00:00Z"),
      endMs: ms("2026-04-21T07:00:00Z"),
    }));

    const layout = buildCalendarEventSpanLayout({
      monthCells: cells,
      events,
      layout: { tier: "lg", cellHeight: 164 },
    });

    const maxLanes = maxSpanLanes(164, { tier: "lg" });
    expect(layout.reservedLaneCountByDate["2026-04-20"]).toBe(maxLanes);
  });

  it("keeps all events in pinnedIds even when overflowed", () => {
    const cells = monthCells("2026-04-19", 7);
    const events = Array.from({ length: 5 }, (_, i) => event({
      id: `ad-${i}`,
      title: `All-day ${i}`,
      allDay: true,
      startMs: ms("2026-04-20T07:00:00Z"),
      endMs: ms("2026-04-21T07:00:00Z"),
    }));

    const layout = buildCalendarEventSpanLayout({
      monthCells: cells,
      events,
      layout: { tier: "lg", cellHeight: 164 },
    });

    for (let i = 0; i < 5; i++) {
      expect(layout.pinnedIds.has(`ad-${i}`)).toBe(true);
    }
  });

  it("has no overflow when all spans fit", () => {
    const cells = monthCells("2026-04-19", 7);
    const events = Array.from({ length: 2 }, (_, i) => event({
      id: `ad-${i}`,
      title: `All-day ${i}`,
      allDay: true,
      startMs: ms("2026-04-20T07:00:00Z"),
      endMs: ms("2026-04-21T07:00:00Z"),
    }));

    const layout = buildCalendarEventSpanLayout({
      monthCells: cells,
      events,
      layout: { tier: "lg", cellHeight: 164 },
    });

    expect(layout.spanSegments.length).toBe(2);
    expect(Object.keys(layout.pinnedOverflowByDate)).toHaveLength(0);
  });
});
