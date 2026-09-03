import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import useCalendarScrollSync, { type CalendarMonthTarget } from "./useCalendarScrollSync";

afterEach(cleanup);

function useSyncState(initialMonth: CalendarMonthTarget, agendaOnly: boolean) {
  const [viewDate, setViewDate] = useState(initialMonth);
  const [labelMonth, setLabelMonth] = useState(initialMonth);
  const [, setFetchAnchor] = useState(initialMonth);
  const options = {
    agendaOnly,
    viewDate,
    firstDay: new Date(viewDate.year, viewDate.month, 1).getDay(),
    setViewDate,
    setFetchAnchor,
    setLabelMonth,
    requestAgendaScroll: () => {},
    isDirtyCheck: () => false,
    shakeEditor: () => {},
  };
  const sync = useCalendarScrollSync(options);
  return { sync, viewDate, labelMonth };
}

describe("agenda month synchronization", () => {
  it.each([
    [{ year: 2026, month: 8 }, "2026-10-01", { year: 2026, month: 9 }],
    [{ year: 2026, month: 9 }, "2026-09-30", { year: 2026, month: 8 }],
    [{ year: 2026, month: 11 }, "2027-01-01", { year: 2027, month: 0 }],
    [{ year: 2027, month: 0 }, "2026-12-31", { year: 2026, month: 11 }],
  ] as const)("updates agenda-only navigation from %j as soon as %s is visible", (initial, date, expected) => {
    const { result } = renderHook(() => useSyncState(initial, true));
    act(() => result.current.sync.onAgendaScroll(date));
    expect(result.current.labelMonth).toEqual(expected);
    expect(result.current.viewDate).toEqual(expected);
  });

  it("follows a reverse crossing immediately after a forward crossing", () => {
    const { result } = renderHook(() => useSyncState({ year: 2026, month: 8 }, true));
    act(() => result.current.sync.onAgendaScroll("2026-10-01"));
    expect(result.current.labelMonth).toEqual({ year: 2026, month: 9 });
    act(() => result.current.sync.onAgendaScroll("2026-09-30"));
    expect(result.current.labelMonth).toEqual({ year: 2026, month: 8 });
    expect(result.current.viewDate).toEqual({ year: 2026, month: 8 });
  });

  it("keeps desktop on its grid month while the agenda date is in a spillover week", () => {
    const september = { year: 2026, month: 8 };
    const { result } = renderHook(() => useSyncState(september, false));
    act(() => result.current.sync.onAgendaScroll("2026-10-04"));
    expect(result.current.labelMonth).toEqual(september);
    expect(result.current.viewDate).toEqual(september);
  });
});
