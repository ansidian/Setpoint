import { describe, it, expect } from "vitest";
import { buildMonthPreviewEntries } from "./calendarMonthPreviewModel";
import type { CalendarDeadlineOverlay, CalendarMonthPreviewEntry } from "./calendarMonthPreviewModel";

// June 2026 as reference: index 0 = June (firstDay Mon=1), index 1 = July (firstDay 3).
const REF_YEAR = 2026;
const REF_MONTH = 5;

interface PreviewEvent { id: string; title?: string }
interface PreviewDeadlineData { upcoming: Array<{ id: string; due_date?: string }> }
interface PreviewArgs {
  previous: Map<number, CalendarMonthPreviewEntry<PreviewEvent, PreviewDeadlineData>> | null;
  first: number;
  last: number;
  refYear: number;
  refMonth: number;
  getMonthEvents: (year: number, month: number) => PreviewEvent[];
  getMonthDeadlines: ((year: number, month: number) => PreviewDeadlineData | null) | null;
  activeDeadlineOverlay: CalendarDeadlineOverlay<PreviewDeadlineData> | null;
  monthEvents: Map<string, PreviewEvent[]>;
}

function makeArgs(overrides: Partial<PreviewArgs> = {}): PreviewArgs {
  const juneEvents = [{ id: "e-june", title: "June" }];
  const julyEvents = [{ id: "e-july", title: "July" }];
  const monthEvents = new Map([
    ["2026-5", juneEvents],
    ["2026-6", julyEvents],
  ]);
  return {
    previous: null,
    first: 0,
    last: 1,
    refYear: REF_YEAR,
    refMonth: REF_MONTH,
    getMonthEvents: (year, month) => monthEvents.get(`${year}-${month}`) || [],
    getMonthDeadlines: null,
    activeDeadlineOverlay: null,
    monthEvents,
    ...overrides,
  };
}

describe("buildMonthPreviewEntries", () => {

  it("merges the previous month's events into months that do not start on Sunday", () => {
    // July 2026 starts on Wednesday, so June events that spill into July's
    // leading cells must ride along; shared ids are deduped.
    const juneEvents = [{ id: "shared" }, { id: "june-only" }];
    const julyEvents = [{ id: "shared" }, { id: "july-only" }];
    const monthEvents = new Map([
      ["2026-5", juneEvents],
      ["2026-6", julyEvents],
    ]);
    const result = buildMonthPreviewEntries(makeArgs({ monthEvents, getMonthEvents: (y, m) => monthEvents.get(`${y}-${m}`) || [] }));
    const ids = result.get(1)!.events!.map((event) => event.id);
    expect(ids).toEqual(["shared", "july-only", "june-only"]);
  });

  it("wraps per-month deadline data when the overlay is enabled and passes the overlay through otherwise", () => {
    const juneDeadlines = { upcoming: [{ id: "d1" }] };
    const overlay = { enabled: true, showCompleted: false };
    const withDeadlines = buildMonthPreviewEntries(makeArgs({
      getMonthDeadlines: (year, month) => (year === 2026 && month === 5 ? juneDeadlines : null),
      activeDeadlineOverlay: overlay,
    }));
    expect(withDeadlines.get(0)!.deadlineOverlay).toEqual({
      enabled: true,
      showCompleted: false,
      data: juneDeadlines,
    });
    expect(withDeadlines.get(1)!.deadlineOverlay).toEqual({
      enabled: true,
      showCompleted: false,
      data: juneDeadlines,
    });

    const disabledOverlay = { enabled: false, showCompleted: false };
    const passthrough = buildMonthPreviewEntries(makeArgs({
      getMonthDeadlines: () => juneDeadlines,
      activeDeadlineOverlay: disabledOverlay,
    }));
    expect(passthrough.get(0)!.deadlineOverlay).toBe(disabledOverlay);
  });

  it("merges previous-month deadline data into a month with leading spillover cells", () => {
    const juneDeadlines = { upcoming: [{ id: "d-june", due_date: "2026-06-30" }] };
    const julyDeadlines = { upcoming: [{ id: "d-july", due_date: "2026-07-01" }] };
    const result = buildMonthPreviewEntries(makeArgs({
      getMonthDeadlines: (year, month) => {
        if (year !== 2026) return null;
        if (month === 5) return juneDeadlines;
        if (month === 6) return julyDeadlines;
        return null;
      },
      activeDeadlineOverlay: { enabled: true, showCompleted: false },
    }));

    expect(result.get(1)!.deadlineOverlay!.data!.upcoming).toEqual([
      { id: "d-july", due_date: "2026-07-01" },
      { id: "d-june", due_date: "2026-06-30" },
    ]);
  });
});
