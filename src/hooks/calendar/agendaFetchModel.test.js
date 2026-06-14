import { describe, expect, it } from "vitest";
import {
  agendaMonthRange,
  initialAgendaMonths,
  computeAgendaFetchPlan,
  computeAgendaJumpPlan,
  pruneAgendaMonths,
  scrollCommandTargetMonth,
  AGENDA_KEEP_RADIUS,
} from "./agendaFetchModel.js";

describe("agendaFetchModel", () => {
  describe("agendaMonthRange", () => {
    // Width must match the grid's navigable span (NAVIGABLE_MONTH_RADIUS on
    // each side of today), or grid jumps can target months the agenda
    // refuses to fetch.
    it("spans the grid-navigable window centered on today's month", () => {
      const range = agendaMonthRange("2026-05-25");
      expect(range.months).toHaveLength(49);
      expect(range.months).toContain("2026-05");
      expect(range.startKey).toBe("2024-05");
      expect(range.endKey).toBe("2028-05");
    });

    it("handles January — year boundary in the past half", () => {
      const range = agendaMonthRange("2026-01-15");
      expect(range.months).toHaveLength(49);
      expect(range.months).toContain("2026-01");
      expect(range.startKey).toBe("2024-01");
      expect(range.endKey).toBe("2028-01");
    });

    it("handles December — year boundary in the future half", () => {
      const range = agendaMonthRange("2026-12-01");
      expect(range.months).toHaveLength(49);
      expect(range.months).toContain("2026-12");
      expect(range.startKey).toBe("2024-12");
      expect(range.endKey).toBe("2028-12");
    });

    it("months array is sorted chronologically", () => {
      const range = agendaMonthRange("2026-05-25");
      const sorted = [...range.months].sort();
      expect(range.months).toEqual(sorted);
    });
  });

  describe("initialAgendaMonths", () => {
    it("returns 5 months centered on today", () => {
      const months = initialAgendaMonths("2026-05-25");
      expect(months).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
    });

    it("stays inside the total range when today is near the edge", () => {
      const range = agendaMonthRange("2026-01-15");
      const months = initialAgendaMonths("2026-01-15");
      expect(months.every((m) => range.months.includes(m))).toBe(true);
      expect(months).toHaveLength(5);
      expect(months).toContain("2026-01");
    });

    it("returns months sorted chronologically", () => {
      const months = initialAgendaMonths("2026-12-01");
      const sorted = [...months].sort();
      expect(months).toEqual(sorted);
    });
  });

  describe("computeAgendaFetchPlan", () => {
    const totalRange = agendaMonthRange("2026-05-25");
    const loaded = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

    it("returns empty when topmost is in the middle of loaded range", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2026-05",
        loadedMonths: loaded,
        totalRange,
        threshold: 2,
      });
      expect(plan.needed).toEqual([]);
      expect(plan.direction).toBeNull();
    });

    it("triggers forward fetch when near the end boundary", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2026-06",
        loadedMonths: loaded,
        totalRange,
        threshold: 2,
      });
      expect(plan.direction).toBe("forward");
      expect(plan.needed.length).toBeGreaterThan(0);
      expect(plan.needed.every((m) => m > "2026-07")).toBe(true);
      expect(plan.needed.every((m) => totalRange.months.includes(m))).toBe(true);
    });

    it("triggers backward fetch when near the start boundary", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2026-04",
        loadedMonths: loaded,
        totalRange,
        threshold: 2,
      });
      expect(plan.direction).toBe("backward");
      expect(plan.needed.length).toBeGreaterThan(0);
      expect(plan.needed.every((m) => m < "2026-03")).toBe(true);
      expect(plan.needed.every((m) => totalRange.months.includes(m))).toBe(true);
    });

    it("returns empty when already at the range cap (forward)", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: totalRange.months[totalRange.months.length - 2],
        loadedMonths: totalRange.months.slice(-5),
        totalRange,
        threshold: 2,
      });
      expect(plan.needed).toEqual([]);
      expect(plan.direction).toBeNull();
    });

    it("returns empty when already at the range cap (backward)", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: totalRange.months[1],
        loadedMonths: totalRange.months.slice(0, 5),
        totalRange,
        threshold: 2,
      });
      expect(plan.needed).toEqual([]);
      expect(plan.direction).toBeNull();
    });

    it("returns empty when all months are loaded", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2026-05",
        loadedMonths: totalRange.months,
        totalRange,
        threshold: 2,
      });
      expect(plan.needed).toEqual([]);
      expect(plan.direction).toBeNull();
    });

    it("clamps fetch batch to remaining months in totalRange", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2027-04",
        loadedMonths: ["2027-02", "2027-03", "2027-04"],
        totalRange,
        threshold: 2,
      });
      expect(plan.needed.every((m) => totalRange.months.includes(m))).toBe(true);
      expect(plan.needed.every((m) => m <= totalRange.endKey)).toBe(true);
    });

    it("triggers fetch when topmost is outside loaded range", () => {
      const plan = computeAgendaFetchPlan({
        topmostMonth: "2026-09",
        loadedMonths: loaded,
        totalRange,
        threshold: 2,
      });
      expect(plan.needed.length).toBeGreaterThan(0);
    });
  });

  describe("computeAgendaJumpPlan", () => {
    const totalRange = agendaMonthRange("2026-05-25");
    const loaded = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

    it("returns empty when the target month is already loaded", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2026-05",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.needed).toEqual([]);
      expect(plan.reset).toBe(false);
    });

    it("extends contiguously forward when the target is just past the loaded edge", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2026-09",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(false);
      expect(plan.needed).toEqual(["2026-08", "2026-09"]);
    });

    it("extends contiguously backward when the target is just before the loaded edge", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2026-01",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(false);
      expect(plan.needed).toEqual(["2026-01", "2026-02"]);
    });

    it("resets to a window around the target for far forward jumps", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2027-03",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed).toEqual(["2027-02", "2027-03", "2027-04"]);
    });

    it("resets to a window around the target for far backward jumps", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2025-01",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed).toEqual(["2024-12", "2025-01", "2025-02"]);
    });

    it("clamps the reset window at the start of the total range", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: totalRange.startKey,
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed[0]).toBe(totalRange.startKey);
      expect(plan.needed.every((m) => totalRange.months.includes(m))).toBe(true);
    });

    it("clamps an out-of-range target to the nearest range edge", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2031-01",
        loadedMonths: loaded,
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed[plan.needed.length - 1]).toBe(totalRange.endKey);
    });

    it("heals a gap by resetting when the target falls between loaded islands", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2026-10",
        loadedMonths: ["2026-03", "2026-04", "2027-02", "2027-03"],
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed).toEqual(["2026-09", "2026-10", "2026-11"]);
    });

    it("returns a reset window when nothing is loaded yet", () => {
      const plan = computeAgendaJumpPlan({
        targetMonth: "2026-09",
        loadedMonths: [],
        totalRange,
      });
      expect(plan.reset).toBe(true);
      expect(plan.needed).toEqual(["2026-08", "2026-09", "2026-10"]);
    });

    it("returns empty without a target or range", () => {
      expect(computeAgendaJumpPlan({ targetMonth: null, loadedMonths: loaded, totalRange }).needed).toEqual([]);
      expect(computeAgendaJumpPlan({ targetMonth: "2026-09", loadedMonths: loaded, totalRange: null }).needed).toEqual([]);
    });
  });

  describe("scrollCommandTargetMonth", () => {
    // Every scroll command that can target unloaded data must surface a
    // month for the fetch pipeline, or the command retries forever against
    // a month that never mounts.
    it("derives the month from date-targeted commands", () => {
      expect(scrollCommandTargetMonth({ type: "date", dateKey: "2026-09-15" }, "2026-06-11")).toBe("2026-09");
      expect(scrollCommandTargetMonth({ type: "item", itemId: "e1", dateKey: "2025-01-02" }, "2026-06-11")).toBe("2025-01");
    });

    it("resolves today commands through todayKey", () => {
      expect(scrollCommandTargetMonth({ type: "today" }, "2026-06-11")).toBe("2026-06");
    });

    it("returns null without a command or a usable target", () => {
      expect(scrollCommandTargetMonth(null, "2026-06-11")).toBeNull();
      expect(scrollCommandTargetMonth({ type: "today" }, null)).toBeNull();
      expect(scrollCommandTargetMonth({ type: "date" }, "2026-06-11")).toBeNull();
    });
  });

  describe("pruneAgendaMonths", () => {
    // Continuous scrolling extends the loaded window without bound, and the
    // rail renders every loaded month on each rebuild. Pruning keeps the
    // rendered window proportional to what the user can actually see.
    it("drops months farther than the keep radius from the anchor", () => {
      const loaded = [
        "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
        "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03",
      ];
      const pruned = pruneAgendaMonths({ anchorMonth: "2025-02", loadedMonths: loaded });
      expect(pruned[0]).toBe("2025-01");
      expect(pruned[pruned.length - 1]).toBe("2025-07");
      expect(pruned.every((m) => loaded.includes(m))).toBe(true);
    });

    it("returns the same array reference when nothing needs pruning", () => {
      const loaded = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
      const pruned = pruneAgendaMonths({ anchorMonth: "2026-05", loadedMonths: loaded });
      expect(pruned).toBe(loaded);
    });

    it("returns the input unchanged without an anchor or months", () => {
      const loaded = ["2026-03", "2026-04"];
      expect(pruneAgendaMonths({ anchorMonth: null, loadedMonths: loaded })).toBe(loaded);
      const empty = [];
      expect(pruneAgendaMonths({ anchorMonth: "2026-05", loadedMonths: empty })).toBe(empty);
    });

    it("respects a custom keep radius", () => {
      const loaded = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
      const pruned = pruneAgendaMonths({ anchorMonth: "2026-03", loadedMonths: loaded, keepRadius: 1 });
      expect(pruned).toEqual(["2026-02", "2026-03", "2026-04"]);
    });

    it("preserves chronological order", () => {
      const loaded = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"];
      const pruned = pruneAgendaMonths({ anchorMonth: "2025-10", loadedMonths: loaded });
      expect(pruned).toEqual([...pruned].sort());
    });

    // Guard against prune→prefetch oscillation: a freshly pruned window must
    // leave the topmost month at least the prefetch threshold away from both
    // loaded edges, so pruning never immediately re-triggers a fetch of the
    // months it just dropped.
    it("leaves no immediate prefetch after pruning around the anchor", () => {
      const totalRange = agendaMonthRange("2026-05-25");
      const loaded = totalRange.months.slice(0, 20);
      const anchor = loaded[10];
      const pruned = pruneAgendaMonths({ anchorMonth: anchor, loadedMonths: loaded });
      expect(pruned.length).toBeLessThan(loaded.length);
      const plan = computeAgendaFetchPlan({
        topmostMonth: anchor,
        loadedMonths: pruned,
        totalRange,
        threshold: 2,
      });
      expect(plan.needed).toEqual([]);
    });

    it("never prunes to an empty window when the anchor is out of range", () => {
      const loaded = ["2027-02", "2027-03", "2027-04"];
      const pruned = pruneAgendaMonths({ anchorMonth: "2025-01", loadedMonths: loaded });
      expect(pruned).toBe(loaded);
    });

    it("caps the rendered window at 2 * keep radius + 1 months", () => {
      const totalRange = agendaMonthRange("2026-05-25");
      const pruned = pruneAgendaMonths({
        anchorMonth: "2026-05",
        loadedMonths: totalRange.months,
      });
      expect(pruned).toHaveLength(2 * AGENDA_KEEP_RADIUS + 1);
      expect(pruned).toContain("2026-05");
    });
  });
});
