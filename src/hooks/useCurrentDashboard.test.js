import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../api", () => ({
  getCurrentDashboard: vi.fn(),
  requestCurrentDashboardRefresh: vi.fn(),
  syncCurrentDashboard: vi.fn(),
}));

const { getCurrentDashboard, requestCurrentDashboardRefresh, syncCurrentDashboard } = await import("../api");
const { default: useCurrentDashboard } = await import("./useCurrentDashboard");

const currentPayload = {
  weather: { temp: 72, icon: "Sun" },
  calendar: [{ id: "event-1", title: "Focus" }],
  deadlines: {
    ctm: { upcoming: [{ id: "ctm-1" }], stats: { total: 1 } },
    todoist: { upcoming: [{ id: "todoist-1" }], stats: { total: 1 } },
  },
  bills: [{ id: "bill-1", payee: "Power" }],
  allSchedules: [{ id: "schedule-1" }],
  payeeMap: { payee_1: "Power" },
  actualConfigured: true,
  actualBudgetUrl: "https://actual.example.test",
  activeSnapshot: {
    snapshot: { id: 42 },
    lanes: { needs_attention: [], fyi: [], noise: [] },
    carryover: [],
    filters: { accounts: [], categories: [] },
  },
  providerHealth: {
    currentData: { state: "current", sources: [] },
    todoist: { state: "current", configured: true, lastSuccessAt: "2026-05-04T11:58:00.000Z" },
  },
  systemStatus: {
    state: "current",
    sources: [
      {
        key: "currentData",
        label: "Current data",
        state: "current",
        lastSuccessAt: "2026-05-04T12:00:00.000Z",
        message: "Current dashboard data is fresh.",
      },
      {
        key: "todoist",
        label: "Todoist",
        state: "current",
        lastSuccessAt: "2026-05-04T11:58:00.000Z",
        message: "Todoist mirror is current.",
      },
    ],
  },
  fetchedAt: "2026-05-04T12:00:00.000Z",
};

describe("useCurrentDashboard", () => {
  beforeEach(() => {
    getCurrentDashboard.mockReset().mockResolvedValue(currentPayload);
    requestCurrentDashboardRefresh.mockReset().mockResolvedValue({
      ...currentPayload,
      weather: { temp: 80, icon: "Sun" },
      activeSnapshot: { ...currentPayload.activeSnapshot, snapshot: { id: 99 } },
      fetchedAt: "2026-05-04T12:05:00.000Z",
    });
    syncCurrentDashboard.mockReset().mockResolvedValue({
      ...currentPayload,
      weather: { temp: 85, icon: "Sun" },
      activeSnapshot: { ...currentPayload.activeSnapshot, snapshot: { id: 100 } },
      fetchedAt: "2026-05-04T12:06:00.000Z",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the current endpoint into briefing, live data, and active snapshot adapters", async () => {
    const { result, unmount } = renderHook(() => useCurrentDashboard());

    await act(async () => {});

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(result.current.briefingData.briefing).toMatchObject({
      weather: { temp: 72, icon: "Sun" },
      calendar: [{ id: "event-1", title: "Focus" }],
      ctm: { upcoming: [{ id: "ctm-1" }], stats: { total: 1 } },
      todoist: { upcoming: [{ id: "todoist-1" }], stats: { total: 1 } },
      emails: { summary: "", accounts: [] },
    });
    expect(result.current.liveData).toMatchObject({
      liveWeather: { temp: 72, icon: "Sun" },
      liveCalendar: [{ id: "event-1", title: "Focus" }],
      liveBills: [{ id: "bill-1", payee: "Power" }],
      allSchedules: [{ id: "schedule-1" }],
      payeeMap: { payee_1: "Power" },
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
      lastFetched: "2026-05-04T12:00:00.000Z",
      providerHealth: currentPayload.providerHealth,
      systemStatus: currentPayload.systemStatus,
    });
    expect(result.current.activeSnapshot.snapshot).toEqual(currentPayload.activeSnapshot);
    expect(result.current.systemStatus).toEqual(currentPayload.systemStatus);

    unmount();
  });

  it("uses light refresh for polling, background refresh for manual sync, and keeps force sync separate", async () => {
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      await result.current.liveData.refreshNow();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(requestCurrentDashboardRefresh).not.toHaveBeenCalled();
    expect(syncCurrentDashboard).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.activeSnapshot.sync();
    });
    expect(requestCurrentDashboardRefresh).toHaveBeenCalledTimes(1);
    expect(syncCurrentDashboard).not.toHaveBeenCalled();
    expect(result.current.liveData.liveWeather).toEqual({ temp: 80, icon: "Sun" });
    expect(result.current.activeSnapshot.snapshot.snapshot).toEqual({ id: 99 });

    await act(async () => {
      await result.current.forceSync();
    });
    expect(syncCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(result.current.liveData.liveWeather).toEqual({ temp: 85, icon: "Sun" });
    expect(result.current.activeSnapshot.snapshot.snapshot).toEqual({ id: 100 });

    unmount();
  });
});
