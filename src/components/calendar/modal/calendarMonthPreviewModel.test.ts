import { describe, it, expect } from "vitest";
import { buildMonthPreviewEntries, resolveMountedMonthData } from "./calendarMonthPreviewModel";
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
  it("reuses entry identity for months whose inputs are unchanged across window shifts", () => {
    const args = makeArgs();
    const firstPass = buildMonthPreviewEntries(args);
    const julyEntry = firstPass.get(1);
    expect(julyEntry).toBeTruthy();

    const secondPass = buildMonthPreviewEntries({ ...args, previous: firstPass, first: 1, last: 2 });
    expect(secondPass.get(1)).toBe(julyEntry);
    expect(secondPass.has(0)).toBe(false);
    expect(secondPass.get(2)).toBeTruthy();
  });

  it("rebuilds only the months whose event arrays changed identity", () => {
    const args = makeArgs();
    const firstPass = buildMonthPreviewEntries(args);

    const newJulyEvents = [{ id: "e-july-2", title: "July refreshed" }];
    args.monthEvents.set("2026-6", newJulyEvents);

    const secondPass = buildMonthPreviewEntries({ ...args, previous: firstPass });
    expect(secondPass.get(0)).toBe(firstPass.get(0));
    expect(secondPass.get(1)).not.toBe(firstPass.get(1));
    expect(secondPass.get(1)!.events).toContain(newJulyEvents[0]);
  });

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

describe("resolveMountedMonthData", () => {
  const EMPTY = {};
  const active = {
    viewData: { isLoading: false },
    itemsByDay: { 1: ["a"] },
    itemsByDate: { "2026-05-01": ["a"] },
    cellMetaByDate: { "2026-05-01": { weather: {} } },
  };
  const cached = {
    viewData: { cached: true },
    itemsByDay: { 2: ["c"] },
    itemsByDate: { "2026-04-02": ["c"] },
    cellMetaByDate: {},
  };

  it("hands the active month its live computed bundle", () => {
    expect(resolveMountedMonthData({ isActive: true, active, empty: EMPTY })).toBe(active);
  });

  it("reuses the cached snapshot for the one-deep cached month", () => {
    const out = resolveMountedMonthData({ isActive: false, isCached: true, cached, active, empty: EMPTY });
    expect(out.itemsByDate).toBe(cached.itemsByDate);
    expect(out.viewData).toBe(cached.viewData);
  });

  it("renders other mounted months empty by default", () => {
    const out = resolveMountedMonthData({ isActive: false, isCached: false, active, empty: EMPTY });
    expect(out.viewData).toBeNull();
    expect(out.itemsByDate).toBe(EMPTY);
    expect(out.itemsByDay).toBe(EMPTY);
  });

  it("shares the active itemsByDate across non-active months when the view is month-agnostic", () => {
    const out = resolveMountedMonthData({ isActive: false, isCached: false, active, shareItemsByDate: true, empty: EMPTY });
    expect(out.itemsByDate).toBe(active.itemsByDate);
    // Non-itemsByDate slots stay empty — only the date-keyed map is month-agnostic.
    expect(out.viewData).toBeNull();
  });

  it("prefers the live active itemsByDate over the stale cached one when sharing", () => {
    const out = resolveMountedMonthData({ isActive: false, isCached: true, cached, active, shareItemsByDate: true, empty: EMPTY });
    expect(out.itemsByDate).toBe(active.itemsByDate);
    expect(out.viewData).toBe(cached.viewData);
  });

  it("shares live absolute-date cell metadata across non-active months", () => {
    const out = resolveMountedMonthData({ isActive: false, isCached: true, cached, active, empty: EMPTY });
    expect(out.cellMetaByDate).toBe(active.cellMetaByDate);
    expect(out.viewData).toBe(cached.viewData);
  });
});
