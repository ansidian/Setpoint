import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarScrollSync, { type CalendarScrollSyncOptions } from "./useCalendarScrollSync";

function setup(overrides: Partial<CalendarScrollSyncOptions> = {}) {
  const props = {
    requestAgendaScroll: vi.fn(),
    viewDate: { year: 2026, month: 4 },
    firstDay: 5,
    setViewDate: vi.fn(),
    setFetchAnchor: vi.fn(),
    setLabelMonth: vi.fn(),
    isDirtyCheck: vi.fn(() => false),
    isEditorOpenCheck: vi.fn(() => false),
    shakeEditor: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(
    (p) => useCalendarScrollSync(p),
    { initialProps: props },
  );
  return { ...props, ...hook };
}

describe("useCalendarScrollSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("agenda → grid sync", () => {
    it("navigates grid when agenda scrolls past grid boundary", () => {
      // May 2026: May 1 is Friday (day 5), grid shows Apr 27 – Jun 7
      // June 10 is outside that range → should nav to June (month 5)
      const { result, setViewDate, setFetchAnchor, setLabelMonth } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });

      expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 5 });
      expect(setFetchAnchor).not.toHaveBeenCalled();
      expect(setLabelMonth).toHaveBeenCalledWith({ year: 2026, month: 5 });
    });

    it("does not navigate when agenda date is within grid range", () => {
      const { result, setViewDate, setFetchAnchor, setLabelMonth } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-05-15");
      });

      expect(setViewDate).not.toHaveBeenCalled();
      expect(setFetchAnchor).not.toHaveBeenCalled();
      expect(setLabelMonth).not.toHaveBeenCalled();
    });
  });

  describe("grid → agenda sync", () => {
    it("requests an agenda scroll to first of month when grid scroll settles", () => {
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 6 });
      });

      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-07-01" });
    });

  });

  describe("grid → agenda crossing sync (leading edge)", () => {
    it("issues a command on the first month crossing", () => {
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 6 });
      });

      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-07-01" });
    });

    it("throttles rapid crossings to one command per interval", () => {
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 6 });
      });
      nowSpy.mockReturnValue(1200);
      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 5 });
      });
      nowSpy.mockReturnValue(1400);
      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 4 });
      });
      expect(requestAgendaScroll).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1700);
      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 3 });
      });
      expect(requestAgendaScroll).toHaveBeenCalledTimes(2);
      expect(requestAgendaScroll).toHaveBeenLastCalledWith({ type: "date", dateKey: "2026-04-01" });
    });

    it("dedupes the settle echo of a just-issued crossing target", () => {
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 6 });
      });
      nowSpy.mockReturnValue(1300);
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 6 });
      });

      expect(requestAgendaScroll).toHaveBeenCalledTimes(1);
    });

    it("lets the settle override a throttled crossing with a different target", () => {
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 6 });
      });
      nowSpy.mockReturnValue(1300);
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 8 });
      });

      expect(requestAgendaScroll).toHaveBeenCalledTimes(2);
      expect(requestAgendaScroll).toHaveBeenLastCalledWith({ type: "date", dateKey: "2026-09-01" });
    });

    it("blocks crossings while agenda-driven suppression is active", () => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });
      act(() => {
        result.current.onGridScrollCrossing({ year: 2026, month: 5 });
      });

      expect(requestAgendaScroll).not.toHaveBeenCalled();
    });
  });

  describe("suppression", () => {
    it("suppresses grid feedback after agenda triggers grid nav", () => {
      const { result, setViewDate, requestAgendaScroll } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });
      expect(setViewDate).toHaveBeenCalledTimes(1);

      // Grid fires onDisplayMonthChange in response — agenda should NOT be scrolled
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 5 });
      });
      expect(requestAgendaScroll).not.toHaveBeenCalled();
    });

    it("suppresses agenda feedback after grid triggers agenda jump", () => {
      const { result, setViewDate } = setup();

      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 6 });
      });

      // Agenda fires onAgendaScroll in response — grid should NOT be navigated
      act(() => {
        result.current.onAgendaScroll("2026-07-15");
      });
      expect(setViewDate).not.toHaveBeenCalled();
    });

    it("lifts suppression after 900ms", () => {
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, requestAgendaScroll } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });

      // Immediate grid feedback → suppressed
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 5 });
      });
      expect(requestAgendaScroll).not.toHaveBeenCalled();

      // Advance past 900ms
      nowSpy.mockReturnValue(2000);

      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 6 });
      });
      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-07-01" });
    });
  });

  describe("isAgendaDriven", () => {
    it("returns true while agenda suppression is active", () => {
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result } = setup();

      expect(result.current.isAgendaDriven()).toBe(false);

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });

      expect(result.current.isAgendaDriven()).toBe(true);

      nowSpy.mockReturnValue(1950);
      expect(result.current.isAgendaDriven()).toBe(false);
    });

    it("prevents grid scroll handlers from overwriting agenda-driven viewDate", () => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const { result, setViewDate, setLabelMonth, requestAgendaScroll } = setup();

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });
      expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 5 });
      vi.mocked(setViewDate).mockClear();
      vi.mocked(setLabelMonth).mockClear();

      // Grid settle fires with old month during suppression window.
      // Controller pattern: if (!sync.isAgendaDriven()) { setViewDate; later sync.onGridScrollSettle; }
      expect(result.current.isAgendaDriven()).toBe(true);

      // onGridScrollSettle also blocked (redundant with isAgendaDriven but tests both gates)
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 4 });
      });
      expect(requestAgendaScroll).not.toHaveBeenCalled();
      expect(setViewDate).not.toHaveBeenCalled();
    });
  });

  describe("navigateToDate", () => {
    it("requests agenda scroll and updates grid state for a different month", () => {
      const { result, requestAgendaScroll, setViewDate, setFetchAnchor, setLabelMonth } = setup();

      let returned;
      act(() => {
        returned = result.current.navigateToDate("2026-07-15");
      });

      expect(returned).toBe(true);
      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-07-15" });
      expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 6 });
      expect(setFetchAnchor).toHaveBeenCalledWith({ year: 2026, month: 6 });
      expect(setLabelMonth).toHaveBeenCalledWith({ year: 2026, month: 6 });
    });

    it("does not update grid state when date is in the current month", () => {
      const { result, requestAgendaScroll, setViewDate } = setup();

      act(() => {
        result.current.navigateToDate("2026-05-20");
      });

      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-05-20" });
      expect(setViewDate).not.toHaveBeenCalled();
    });
  });

  describe("navigateToMonth", () => {
    it("requests agenda scroll to first of month and updates all state", () => {
      const { result, requestAgendaScroll, setViewDate, setFetchAnchor, setLabelMonth } = setup();

      let returned;
      act(() => {
        returned = result.current.navigateToMonth(2026, 8);
      });

      expect(returned).toBe(true);
      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-09-01" });
      expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 8 });
      expect(setFetchAnchor).toHaveBeenCalledWith({ year: 2026, month: 8 });
      expect(setLabelMonth).toHaveBeenCalledWith({ year: 2026, month: 8 });
    });
  });

  describe("syncAgendaToMonth", () => {
    it("requests an agenda scroll without touching grid state", () => {
      const { result, requestAgendaScroll, setViewDate, setFetchAnchor, setLabelMonth } = setup();

      act(() => {
        result.current.syncAgendaToMonth(2026, 8);
      });

      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-09-01" });
      expect(setViewDate).not.toHaveBeenCalled();
      expect(setFetchAnchor).not.toHaveBeenCalled();
      expect(setLabelMonth).not.toHaveBeenCalled();
    });

    it("is not blocked by a dirty editor (callers own editor semantics)", () => {
      const isDirtyCheck = vi.fn(() => true);
      const shakeEditor = vi.fn();
      const { result, requestAgendaScroll } = setup({ isDirtyCheck, shakeEditor });

      act(() => {
        result.current.syncAgendaToMonth(2026, 8);
      });

      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "date", dateKey: "2026-09-01" });
      expect(shakeEditor).not.toHaveBeenCalled();
    });

    it("suppresses feedback in both directions", () => {
      const { result, setViewDate, requestAgendaScroll } = setup();

      act(() => {
        result.current.syncAgendaToMonth(2026, 8);
      });
      vi.mocked(requestAgendaScroll).mockClear();

      // Grid settle echo → no second agenda scroll
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 8 });
      });
      expect(requestAgendaScroll).not.toHaveBeenCalled();

      // Agenda passive echo → no grid nav
      act(() => {
        result.current.onAgendaScroll("2026-09-15");
      });
      expect(setViewDate).not.toHaveBeenCalled();
    });
  });

  describe("dirty editor gate", () => {
    it("blocks programmatic nav and shakes when dirty", () => {
      const isDirtyCheck = vi.fn(() => true);
      const shakeEditor = vi.fn();
      const { result, requestAgendaScroll, setViewDate } = setup({ isDirtyCheck, shakeEditor });

      let returned;
      act(() => {
        returned = result.current.navigateToDate("2026-07-15");
      });

      expect(returned).toBe(false);
      expect(shakeEditor).toHaveBeenCalled();
      expect(requestAgendaScroll).not.toHaveBeenCalled();
      expect(setViewDate).not.toHaveBeenCalled();
    });

    it("does NOT block free scroll even when dirty", () => {
      const isDirtyCheck = vi.fn(() => true);
      const { result, setViewDate, setFetchAnchor, setLabelMonth } = setup({ isDirtyCheck });

      act(() => {
        result.current.onAgendaScroll("2026-06-10");
      });

      expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 5 });
      expect(setFetchAnchor).not.toHaveBeenCalled();
      expect(setLabelMonth).toHaveBeenCalledWith({ year: 2026, month: 5 });
    });
  });

  describe("navigateToToday", () => {
    it("routes through a today command and updates grid state", () => {
      const today = new Date();
      const todayYear = today.getFullYear();
      const todayMonth = today.getMonth();
      const viewDate = { year: 2020, month: 0 };
      const { result, requestAgendaScroll, setViewDate, setFetchAnchor, setLabelMonth } = setup({ viewDate });

      let returned;
      act(() => {
        returned = result.current.navigateToToday();
      });

      expect(returned).toBe(true);
      expect(requestAgendaScroll).toHaveBeenCalledWith({ type: "today" });
      expect(setViewDate).toHaveBeenCalledWith({ year: todayYear, month: todayMonth });
      expect(setFetchAnchor).toHaveBeenCalledWith({ year: todayYear, month: todayMonth });
      expect(setLabelMonth).toHaveBeenCalledWith({ year: todayYear, month: todayMonth });
    });
  });

  describe("programmatic nav suppression", () => {
    it("suppresses both directions after navigateToDate", () => {
      const { result, requestAgendaScroll, setViewDate } = setup();

      act(() => {
        result.current.navigateToDate("2026-07-15");
      });
      vi.mocked(setViewDate).mockClear();

      // Grid settle fires onGridScrollSettle → should NOT scroll agenda again
      act(() => {
        result.current.onGridScrollSettle({ year: 2026, month: 6 });
      });
      expect(requestAgendaScroll).toHaveBeenCalledTimes(1);

      // Agenda scroll fires back → should NOT update grid again
      act(() => {
        result.current.onAgendaScroll("2026-07-15");
      });
      expect(setViewDate).not.toHaveBeenCalled();
    });
  });
});
