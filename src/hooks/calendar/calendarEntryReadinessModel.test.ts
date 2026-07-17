import { describe, expect, it } from "vitest";
import { getVisibleGridRange } from "../../components/calendar/calendarDateUtils.ts";
import { computeCalendarEntryReadiness } from "./calendarEntryReadinessModel";

// June 2026 — the model derives prev/next months and the visible grid range
// from these, so anchor every fixture on the same month.
const VIEW_YEAR = 2026;
const VIEW_MONTH = 5;
const VISIBLE_RANGE = getVisibleGridRange(VIEW_YEAR, VIEW_MONTH);
const IN_RANGE_DATE = VISIBLE_RANGE.start;

// "Everything resolved" baseline: events fetched, deadlines ready, overlay shown.
// agendaEntryReady should be true. Individual tests flip ONE input to prove which
// gate each rule owns.
function readyArgs(overrides = {}) {
  return {
    viewYear: VIEW_YEAR,
    viewMonth: VIEW_MONTH,
    eventsLoading: false,
    eventsIsMonthLoading: () => false,
    eventsEnsureRange: () => {},
    deadlineOverlayVisible: true,
    committedDeadlineOverlayData: null,
    deadlinesEnsureRange: () => {},
    deadlinesSeedData: null,
    deadlinesDataRange: null,
    deadlinesData: null,
    planningReadiness: {
      state: "ready",
      eventsReadyAt: 100,
      deadlinesReadyAt: 200,
      deadlinesDelayed: false,
    },
    ...overrides,
  };
}

describe("computeCalendarEntryReadiness", () => {
  it("reports the agenda ready when events and deadlines are both resolved", () => {
    const { eventsRangeLoading, agendaEntryReady } = computeCalendarEntryReadiness(readyArgs());
    expect(eventsRangeLoading).toBe(false);
    expect(agendaEntryReady).toBe(true);
  });

  describe("eventsRangeLoading", () => {
    it("is true when the events feed reports a top-level load", () => {
      const { eventsRangeLoading } = computeCalendarEntryReadiness(readyArgs({ eventsLoading: true }));
      expect(eventsRangeLoading).toBe(true);
    });

    it("is true when only the trailing (next) mounted month is still loading", () => {
      const nextMonthLoading = (year: number, month: number) => year === 2026 && month === 6;
      const { eventsRangeLoading } = computeCalendarEntryReadiness(
        readyArgs({ eventsIsMonthLoading: nextMonthLoading }),
      );
      expect(eventsRangeLoading).toBe(true);
    });

    it("is true when only the leading (prev) mounted month is still loading", () => {
      const prevMonthLoading = (year: number, month: number) => year === 2026 && month === 4;
      const { eventsRangeLoading } = computeCalendarEntryReadiness(
        readyArgs({ eventsIsMonthLoading: prevMonthLoading }),
      );
      expect(eventsRangeLoading).toBe(true);
    });

    it("is true when only the current view month is still loading", () => {
      const viewMonthLoading = (year: number, month: number) => year === 2026 && month === 5;
      const { eventsRangeLoading } = computeCalendarEntryReadiness(
        readyArgs({ eventsIsMonthLoading: viewMonthLoading }),
      );
      expect(eventsRangeLoading).toBe(true);
    });

    it("stays false when no mounted month is loading", () => {
      const { eventsRangeLoading } = computeCalendarEntryReadiness(readyArgs());
      expect(eventsRangeLoading).toBe(false);
    });
  });

  describe("events entry gate", () => {
    it("holds the agenda while an events range fetch has not reported ready", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: { state: "ready", eventsReadyAt: null, deadlinesReadyAt: 200, deadlinesDelayed: false },
        }),
      );
      expect(agendaEntryReady).toBe(false);
    });

    it("treats events as ready when there is no events range fetcher at all", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          eventsEnsureRange: null,
          planningReadiness: { state: "ready", eventsReadyAt: null, deadlinesReadyAt: 200, deadlinesDelayed: false },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });
  });

  describe("deadlines entry gate", () => {
    it("holds the agenda while the deadline overlay is shown but has not reported ready", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          // state "ready" keeps awaitingDeadlineOverlay false so the failure is
          // attributable purely to the deadlines-entry gate.
          planningReadiness: { state: "ready", eventsReadyAt: 100, deadlinesReadyAt: null, deadlinesDelayed: false },
        }),
      );
      expect(agendaEntryReady).toBe(false);
    });

    it("releases the agenda when deadlines are explicitly delayed", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: { state: "ready", eventsReadyAt: 100, deadlinesReadyAt: null, deadlinesDelayed: true },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("ignores the deadline gate entirely when the overlay is hidden", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          deadlineOverlayVisible: false,
          planningReadiness: { state: "ready", eventsReadyAt: 100, deadlinesReadyAt: null, deadlinesDelayed: false },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });
  });

  describe("awaitingDeadlineOverlay", () => {
    const loadingNoData = {
      state: "loading",
      eventsReadyAt: 100,
      // deadlinesReadyAt is set so the deadlines-entry gate passes; the only thing
      // that can hold the agenda here is awaitingDeadlineOverlay.
      deadlinesReadyAt: 200,
      deadlinesDelayed: false,
    };

    // The awaiting window is gated on the planning state being one of
    // idle/loading/slow — each must individually hold the agenda so the gate
    // set can't be narrowed without a test failing.
    it.each(["idle", "loading", "slow"])(
      "holds the agenda while the overlay is %s with no resolved range or visible seed",
      (state) => {
        const { agendaEntryReady } = computeCalendarEntryReadiness(
          readyArgs({ planningReadiness: { ...loadingNoData, state } }),
        );
        expect(agendaEntryReady).toBe(false);
      },
    );

    it("releases the agenda once the planning state leaves the loading window", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({ planningReadiness: { ...loadingNoData, state: "degraded" } }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("never awaits while the deadline overlay is hidden, even mid-load", () => {
      // Hidden overlay short-circuits the await regardless of planning state.
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({ deadlineOverlayVisible: false, planningReadiness: loadingNoData }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("does not await when there is no deadline range fetcher, even mid-load", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          deadlinesEnsureRange: null,
          planningReadiness: { state: "loading", eventsReadyAt: 100, deadlinesReadyAt: null, deadlinesDelayed: false },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("releases the agenda once a committed overlay record covers the visible range", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          committedDeadlineOverlayData: { data: { upcoming: [] }, range: VISIBLE_RANGE },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("ignores a committed overlay record whose range does not match the visible grid", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          committedDeadlineOverlayData: {
            data: { upcoming: [] },
            range: { start: "1999-01-01", end: "1999-01-31" },
          },
        }),
      );
      expect(agendaEntryReady).toBe(false);
    });

    it("releases the agenda when the seeded data range matches the visible grid (resolved path)", () => {
      // Empty `upcoming` => no visible seed item, so release here can ONLY come
      // from hasResolvedDeadlineRange's seed-and-matching-range branch.
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          deadlinesSeedData: { upcoming: [] },
          deadlinesDataRange: VISIBLE_RANGE,
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("releases the agenda when an in-progress seed already has visible items (no committed range)", () => {
      // dataRange null => hasResolvedDeadlineRange is false, so release here can
      // ONLY come from the hasVisibleDeadlineSeed path over the seed data.
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          deadlinesSeedData: { upcoming: [{ agendaDateKey: IN_RANGE_DATE }] },
          deadlinesDataRange: null,
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });

    it("keeps awaiting when the in-progress seed falls outside the visible range", () => {
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          deadlinesSeedData: { upcoming: [{ agendaDateKey: "1999-01-01" }] },
          deadlinesDataRange: null,
        }),
      );
      expect(agendaEntryReady).toBe(false);
    });

    it("releases the agenda when current deadline data already has visible items", () => {
      // No seed at all — the only release source is currentOverlayData (deadlinesData).
      const { agendaEntryReady } = computeCalendarEntryReadiness(
        readyArgs({
          planningReadiness: loadingNoData,
          deadlinesSeedData: null,
          deadlinesDataRange: null,
          deadlinesData: { upcoming: [{ agendaDateKey: IN_RANGE_DATE }] },
        }),
      );
      expect(agendaEntryReady).toBe(true);
    });
  });
});
