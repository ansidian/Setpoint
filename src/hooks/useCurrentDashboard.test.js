import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../api", () => ({
  getCurrentDashboard: vi.fn(),
  requestCurrentDashboardRefresh: vi.fn(),
  syncCurrentDashboard: vi.fn(),
}));

const { getCurrentDashboard, requestCurrentDashboardRefresh, syncCurrentDashboard } = await import("../api");
const { default: useCurrentDashboard } = await import("./useCurrentDashboard");

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type, data = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

function setDocumentHidden(hidden) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

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
    setDocumentHidden(false);
    FakeEventSource.instances = [];
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
    vi.unstubAllGlobals();
    setDocumentHidden(false);
    vi.useRealTimers();
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
    expect(result.current.briefingData.briefing).not.toHaveProperty("aiInsights");
    expect(result.current.briefingData).not.toHaveProperty("generating");
    expect(result.current.briefingData).not.toHaveProperty("genProgress");
    expect(result.current.briefingData).not.toHaveProperty("handleFullGeneration");
    expect(result.current.briefingData).not.toHaveProperty("selectHistory");
    expect(result.current.briefingData).not.toHaveProperty("navigateToEmail");

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

  it("polls current dashboard briefly after manual sync while work is active", async () => {
    vi.useFakeTimers();
    requestCurrentDashboardRefresh.mockResolvedValueOnce({
      ...currentPayload,
      providerHealth: {
        ...currentPayload.providerHealth,
        currentData: {
          state: "current",
          sources: [{ key: "weather_current", state: "refreshing", severity: "info" }],
        },
        activeSnapshot: { state: "syncing", reason: "background" },
      },
      refresh: {
        mode: "manual",
        scheduled: [{ key: "weather_current", reason: "ttl_due" }],
        skipped: [],
      },
    });
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        weather: { temp: 81, icon: "Sun" },
        providerHealth: {
          ...currentPayload.providerHealth,
          currentData: {
            state: "current",
            sources: [{ key: "weather_current", state: "current", severity: "none" }],
          },
        },
        refresh: { mode: "passive", scheduled: [], skipped: [] },
        fetchedAt: "2026-05-04T12:07:00.000Z",
      });
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    let syncPromise;
    await act(async () => {
      syncPromise = result.current.activeSnapshot.sync();
    });
    expect(requestCurrentDashboardRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await syncPromise;
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.liveData.liveWeather).toEqual({ temp: 81, icon: "Sun" });
    unmount();
  });

  it("keeps manual sync polling long enough for Bills force refresh to settle", async () => {
    vi.useFakeTimers();
    requestCurrentDashboardRefresh.mockResolvedValueOnce({
      ...currentPayload,
      providerHealth: {
        ...currentPayload.providerHealth,
        currentData: {
          state: "current",
          sources: [{ key: "bills_current", state: "refreshing", severity: "info" }],
        },
        activeSnapshot: { state: "syncing", reason: "background" },
      },
      refresh: {
        mode: "manual",
        scheduled: [{ key: "bills_current", reason: "manual_bills_sync" }],
        skipped: [],
      },
    });
    let pollCount = 0;
    getCurrentDashboard.mockImplementation(async () => {
      if (pollCount === 0) {
        pollCount += 1;
        return currentPayload;
      }
      pollCount += 1;
      if (pollCount < 16) {
        return {
          ...currentPayload,
          providerHealth: {
            ...currentPayload.providerHealth,
            currentData: {
              state: "current",
              sources: [{ key: "bills_current", state: "refreshing", severity: "info" }],
            },
          },
          refresh: { mode: "passive", scheduled: [], skipped: [] },
        };
      }
      return {
        ...currentPayload,
        allSchedules: [{ id: "water", payee: "SGV Water" }],
        providerHealth: {
          ...currentPayload.providerHealth,
          currentData: {
            state: "current",
            sources: [{ key: "bills_current", state: "current", severity: "none" }],
          },
        },
        refresh: { mode: "passive", scheduled: [], skipped: [] },
        fetchedAt: "2026-05-05T00:40:00.000Z",
      };
    });
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    let syncPromise;
    await act(async () => {
      syncPromise = result.current.activeSnapshot.sync();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await syncPromise;
    });

    expect(result.current.current.fetchedAt).toBe("2026-05-05T00:40:00.000Z");
    expect(result.current.liveData.allSchedules).toEqual([{ id: "water", payee: "SGV Water" }]);
    unmount();
  });

  it("does not poll after manual sync when no work was scheduled", async () => {
    requestCurrentDashboardRefresh.mockResolvedValueOnce({
      ...currentPayload,
      refresh: { mode: "manual", scheduled: [], skipped: [{ key: "weather_current", reason: "fresh" }] },
    });
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      await result.current.activeSnapshot.sync();
    });

    expect(requestCurrentDashboardRefresh).toHaveBeenCalledTimes(1);
    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("subscribes to dashboard-current events and silently refetches current data", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        deadlines: {
          ...currentPayload.deadlines,
          todoist: { upcoming: [{ id: "todoist-live" }], stats: { total: 1 } },
        },
        fetchedAt: "2026-05-05T00:20:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/dashboard/current/events");

    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", {
        source: "todoist",
        reason: "sync_settled",
        state: "current",
      });
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.briefingData.briefing.todoist.upcoming).toEqual([{ id: "todoist-live" }]);
    expect(result.current.refreshing).toBe(false);

    unmount();
  });

  it("passes dashboard-current SSE payloads to event consumers while refetching", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onDashboardEvent = vi.fn();
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        fetchedAt: "2026-05-05T00:21:00.000Z",
      });

    const { unmount } = renderHook(() => useCurrentDashboard({ onDashboardEvent }));
    await act(async () => {});

    const payload = {
      source: "email_triage",
      reason: "email_triage_finalized",
      details: {
        triggerType: "needs_attention_finalized",
        eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
      },
    };
    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", payload);
      await Promise.resolve();
    });

    expect(onDashboardEvent).toHaveBeenCalledWith(payload);
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("closes the dashboard-current event stream on unmount and skips it when disabled", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);

    FakeEventSource.instances = [];
    const disabled = renderHook(() => useCurrentDashboard({ disabled: true }));
    await act(async () => {});

    expect(FakeEventSource.instances).toHaveLength(0);
    disabled.unmount();
  });

  it("defers SSE-triggered refetch while hidden and catches up when visible", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        fetchedAt: "2026-05-05T00:25:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    setDocumentHidden(true);
    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", {
        source: "todoist",
        reason: "webhook_received",
        state: "needs_sync",
      });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current.fetchedAt).toBe("2026-05-05T00:25:00.000Z");
    unmount();
  });

  it("coalesces dashboard-current events that arrive during an in-flight refetch", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveFirstEventFetch;
    const firstEventFetch = new Promise((resolve) => {
      resolveFirstEventFetch = resolve;
    });
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockReturnValueOnce(firstEventFetch)
      .mockResolvedValueOnce({
        ...currentPayload,
        fetchedAt: "2026-05-05T00:30:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", { source: "todoist" });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);

    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", { source: "todoist" });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirstEventFetch({
        ...currentPayload,
        fetchedAt: "2026-05-05T00:29:00.000Z",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.current.fetchedAt).toBe("2026-05-05T00:30:00.000Z");
    unmount();
  });

  it("polls silently after an SSE refetch schedules current-data refresh work", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        providerHealth: {
          ...currentPayload.providerHealth,
          currentData: {
            state: "current",
            sources: [{ key: "deadlines_current", state: "refreshing", severity: "info" }],
          },
        },
        refresh: {
          mode: "passive",
          scheduled: [{ key: "deadlines_current", reason: "needs_sync" }],
          skipped: [],
        },
      })
      .mockResolvedValueOnce({
        ...currentPayload,
        deadlines: {
          ...currentPayload.deadlines,
          todoist: { upcoming: [{ id: "todoist-live" }], stats: { total: 1 } },
        },
        providerHealth: {
          ...currentPayload.providerHealth,
          currentData: {
            state: "current",
            sources: [{ key: "deadlines_current", state: "current", severity: "none" }],
          },
        },
        refresh: { mode: "passive", scheduled: [], skipped: [] },
        fetchedAt: "2026-05-05T00:35:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", {
        source: "todoist",
        reason: "sync_settled",
        state: "current",
      });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.briefingData.briefing.todoist.upcoming).toEqual([{ id: "todoist-1" }]);
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.briefingData.briefing.todoist.upcoming).toEqual([{ id: "todoist-live" }]);
    expect(result.current.refreshing).toBe(false);
    unmount();
  });
});
