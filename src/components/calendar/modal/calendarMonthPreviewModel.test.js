import { describe, it, expect } from "vitest";
import { buildMonthPreviewEntries } from "./calendarMonthPreviewModel.js";

// June 2026 as reference: index 0 = June (firstDay Mon=1), index 1 = July (firstDay 3).
const REF_YEAR = 2026;
const REF_MONTH = 5;

function makeArgs(overrides = {}) {
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
    expect(secondPass.get(1).events).toContain(newJulyEvents[0]);
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
    const ids = result.get(1).events.map((event) => event.id);
    expect(ids).toEqual(["shared", "july-only", "june-only"]);
  });

  it("wraps per-month deadline data when the overlay is enabled and passes the overlay through otherwise", () => {
    const juneDeadlines = { upcoming: [{ id: "d1" }] };
    const overlay = { enabled: true, showCompleted: false };
    const withDeadlines = buildMonthPreviewEntries(makeArgs({
      getMonthDeadlines: (year, month) => (year === 2026 && month === 5 ? juneDeadlines : null),
      activeDeadlineOverlay: overlay,
    }));
    expect(withDeadlines.get(0).deadlineOverlay).toEqual({
      enabled: true,
      showCompleted: false,
      data: juneDeadlines,
    });
    expect(withDeadlines.get(1).deadlineOverlay).toBeNull();

    const disabledOverlay = { enabled: false, showCompleted: false };
    const passthrough = buildMonthPreviewEntries(makeArgs({
      getMonthDeadlines: () => juneDeadlines,
      activeDeadlineOverlay: disabledOverlay,
    }));
    expect(passthrough.get(0).deadlineOverlay).toBe(disabledOverlay);
  });
});
