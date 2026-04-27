import { describe, it, expect } from "vitest";
import eventsView from "./eventsView.jsx";

function ev({ iso, title, color = "#4285f4", source = "gmail" }) {
  return {
    startMs: new Date(iso).getTime(),
    endMs: new Date(iso).getTime() + 30 * 60000,
    title,
    color,
    source,
    allDay: false,
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
    expect(eventsView.getVisibleEventCount(3, { tier: "lg" })).toBe(3);
    expect(eventsView.getVisibleEventCount(4, { tier: "lg" })).toBe(2);
  });

  it("allows denser xl cells without measuring rendered height", () => {
    expect(eventsView.getVisibleEventCount(4, { tier: "xl" })).toBe(4);
    expect(eventsView.getVisibleEventCount(5, { tier: "xl" })).toBe(3);
  });

  it("uses the 4K uhd tier for high-density event cells", () => {
    expect(eventsView.getVisibleEventCount(8, { tier: "uhd" })).toBe(8);
    expect(eventsView.getVisibleEventCount(9, { tier: "uhd" })).toBe(7);
  });
});
