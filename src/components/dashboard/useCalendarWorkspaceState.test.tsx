import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useCalendarWorkspaceState from "./useCalendarWorkspaceState";
import type { DashboardTab } from "./dashboardShellModel";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { CalendarEventCreateRequest } from "../../hooks/calendar/calendarEventCreateBridge";

function createRequest(referenceId: string): CalendarEventCreateRequest {
  return {
    seed: {
      title: "Planning",
      allDay: false,
      startDate: "2026-09-10",
      startTime: "09:00",
      endTime: "09:30",
    },
    origin: { kind: "test", referenceId },
  };
}

function options(tab: DashboardTab) {
  return {
    isMobile: false,
    tab,
    setShellTab: vi.fn(),
    setCalendarMounted: vi.fn(),
    liveData: {} as CurrentDashboardLiveData,
    loadCalendarDeadlines: vi.fn(),
    loadCalendarBills: vi.fn(),
  };
}

describe("useCalendarWorkspaceState create request ownership", () => {
  it("does not clear a newer create request when an older acknowledgement arrives", () => {
    const props = options("calendar");
    const { result } = renderHook(() => useCalendarWorkspaceState(props));

    act(() => result.current.openCalendar("events", null, null, {
      eventCreateRequest: createRequest("first"),
    }));
    const firstRouted = result.current.calendarEventCreateRequest!;

    act(() => result.current.openCalendar("events", null, null, {
      eventCreateRequest: createRequest("second"),
    }));
    const secondRouted = result.current.calendarEventCreateRequest!;

    act(() => firstRouted.onAcknowledged?.({ status: "accepted", origin: firstRouted.origin }));
    expect(result.current.calendarEventCreateRequest).toBe(secondRouted);

    act(() => secondRouted.onAcknowledged?.({ status: "accepted", origin: secondRouted.origin }));
    expect(result.current.calendarEventCreateRequest).toBeNull();
  });

  it("clears a pending seed on an ordinary open and when leaving Calendar", () => {
    const initial = options("calendar");
    const { result, rerender } = renderHook(
      ({ tab }: { tab: DashboardTab }) => useCalendarWorkspaceState({ ...initial, tab }),
      { initialProps: { tab: "calendar" as DashboardTab } },
    );

    act(() => result.current.openCalendar("events", null, null, {
      eventCreateRequest: createRequest("pending"),
    }));
    expect(result.current.calendarEventCreateRequest).not.toBeNull();

    act(() => result.current.openCalendar("events"));
    expect(result.current.calendarEventCreateRequest).toBeNull();

    act(() => result.current.openCalendar("events", null, null, {
      eventCreateRequest: createRequest("leave"),
    }));
    expect(result.current.calendarEventCreateRequest).not.toBeNull();
    rerender({ tab: "dashboard" });
    expect(result.current.calendarEventCreateRequest).toBeNull();
  });
});
