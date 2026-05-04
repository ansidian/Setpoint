import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../api", () => ({
  getLiveData: vi.fn(),
}));

const { getLiveData } = await import("../api");
const { default: useLiveData } = await import("./useLiveData");

let visibilityState = "visible";

Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

describe("useLiveData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    visibilityState = "visible";
    getLiveData.mockReset();
    getLiveData.mockResolvedValue({
      emails: [],
      calendar: [],
      nextWeekCalendar: [],
      tomorrowCalendar: [],
      weather: null,
      bills: [],
      recentTransactions: [],
      allSchedules: [],
      payeeMap: {},
      importantSenders: [],
      briefingGeneratedAt: null,
      briefingReadStatus: {},
      actualConfigured: false,
      actualBudgetUrl: null,
      snoozedEntries: [],
      resurfacedEntries: [],
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("defers the initial live data fetch but keeps manual refresh available", async () => {
    const { result, unmount } = renderHook(() =>
      useLiveData({ disabled: false, initialFetchDelayMs: 250 }),
    );

    await act(async () => {});
    expect(getLiveData).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getLiveData).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refreshNow();
    });
    expect(getLiveData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(getLiveData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getLiveData).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("polls while visible and throttles focus refreshes", async () => {
    const { unmount } = renderHook(() => useLiveData({ disabled: false, initialFetchDelayMs: 0 }));

    await act(async () => {});
    expect(getLiveData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(getLiveData).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getLiveData).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.setSystemTime(new Date("2026-04-22T12:02:16Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(getLiveData).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("skips background interval fetches and refreshes when the tab becomes visible", async () => {
    const { unmount } = renderHook(() => useLiveData({ disabled: false, initialFetchDelayMs: 0 }));

    await act(async () => {});
    expect(getLiveData).toHaveBeenCalledTimes(1);

    visibilityState = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(getLiveData).toHaveBeenCalledTimes(1);

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getLiveData).toHaveBeenCalledTimes(2);
    unmount();
  });
});
