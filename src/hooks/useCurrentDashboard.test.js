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
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    this.readyState = FakeEventSource.OPEN;
    this.onerror = null;
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
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type, data = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  // Simulate the browser firing onerror. `readyState` reflects what the browser
  // would set: CLOSED for a terminal failure (e.g. a 401 handshake), CONNECTING
  // for a transient drop the browser will auto-retry.
  emitError(readyState = FakeEventSource.CLOSED) {
    this.readyState = readyState;
    this.onerror?.({ type: "error" });
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
    upcoming: [{ id: "deadline-1" }],
    stats: { total: 1 },
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
    vi.unstubAllEnvs();
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
      deadlines: { upcoming: [{ id: "deadline-1" }], stats: { total: 1 } },
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

  it("dedups a refetch that returns the same contentKey even when fetchedAt advances, keeping current + liveData references stable", async () => {
    // Initial load carries a content fingerprint (the server attaches one per response).
    getCurrentDashboard
      .mockResolvedValueOnce({ ...currentPayload, contentKey: "ck-1" })
      // A poll/refetch returns a brand-new object with identical contents and the
      // same content key — but a FRESH wall-clock fetchedAt (the server restamps one
      // per response). Dedup must key on contentKey, not fetchedAt, and keep the
      // prior `current` reference so the dashboard tree does not re-render.
      .mockResolvedValueOnce({
        ...currentPayload,
        calendar: [{ id: "event-1", title: "Focus" }],
        contentKey: "ck-1",
        fetchedAt: "2026-05-04T12:00:30.000Z",
      })
      // A refetch with a different contentKey must adopt the fresh payload.
      .mockResolvedValueOnce({
        ...currentPayload,
        weather: { temp: 99, icon: "Sun" },
        contentKey: "ck-2",
        fetchedAt: "2026-05-04T12:10:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    const firstCurrent = result.current.current;
    const firstCalendar = result.current.liveData.liveCalendar;
    expect(firstCurrent.contentKey).toBe("ck-1");

    await act(async () => {
      await result.current.refresh();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current).toBe(firstCurrent);
    expect(result.current.liveData.liveCalendar).toBe(firstCalendar);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.current).not.toBe(firstCurrent);
    expect(result.current.liveData.liveWeather).toEqual({ temp: 99, icon: "Sun" });

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

  it("backs active refresh polling off from 2s to a 16s maximum step", async () => {
    vi.useFakeTimers();
    const activePayload = {
      ...currentPayload,
      providerHealth: {
        ...currentPayload.providerHealth,
        currentData: {
          state: "current",
          sources: [{ key: "bills_current", state: "refreshing", severity: "info" }],
        },
      },
      refresh: {
        mode: "manual",
        scheduled: [{ key: "bills_current", reason: "manual_bills_sync" }],
        skipped: [],
      },
    };
    requestCurrentDashboardRefresh.mockResolvedValueOnce(activePayload);
    const pollTimes = [];
    let startedAt;
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockImplementation(async () => {
        pollTimes.push(Date.now() - startedAt);
        return activePayload;
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    startedAt = Date.now();
    act(() => {
      result.current.activeSnapshot.sync();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(pollTimes).toEqual([2_000, 6_000, 14_000, 30_000]);
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
      if (pollCount < 5) {
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
          upcoming: [{ id: "deadline-live" }],
          stats: { total: 1 },
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
    expect(result.current.briefingData.briefing.deadlines.upcoming).toEqual([{ id: "deadline-live" }]);
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

  it("refreshes active snapshot data after queued email dashboard-current events", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const queuedSnapshot = {
      ...currentPayload.activeSnapshot,
      lanes: {
        ...currentPayload.activeSnapshot.lanes,
        queued: [{
          uid: "queued-arrival",
          email_id: "queued-arrival",
          lane: "queued",
          source: "arrival_grace",
          read: false,
        }],
      },
    };
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        activeSnapshot: queuedSnapshot,
        fetchedAt: "2026-05-05T00:22:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", {
        source: "email_triage",
        reason: "email_triage_queued",
        details: {
          triggerType: "email_queued",
          emailId: "queued-arrival",
          lane: "queued",
        },
      });
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.activeSnapshot.snapshot.lanes.queued).toEqual(queuedSnapshot.lanes.queued);
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

  it("routes to login when the dashboard-current stream fails terminally (expired session)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const location = { href: "/dashboard" };
    vi.stubGlobal("location", location);

    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];

    await act(async () => {
      // 401 handshake -> browser closes the stream (readyState CLOSED), no auto-reconnect.
      source.emitError(FakeEventSource.CLOSED);
      await Promise.resolve();
    });

    expect(source.closed).toBe(true);
    expect(location.href).toBe("/login");
    unmount();
  });

  it("does not redirect on a transient dashboard-current stream blip", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const location = { href: "/dashboard" };
    vi.stubGlobal("location", location);

    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    const source = FakeEventSource.instances[0];

    await act(async () => {
      // Transient drop -> browser is already reconnecting (readyState CONNECTING).
      source.emitError(FakeEventSource.CONNECTING);
      await Promise.resolve();
    });

    expect(source.closed).toBe(false);
    expect(location.href).toBe("/dashboard");
    unmount();
  });

  it("does not open the dashboard-current event stream in demo mode", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    vi.stubGlobal("EventSource", FakeEventSource);

    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
    unmount();
  });

  it("catches up when visible if an SSE-triggered hidden refetch fails", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload)
      .mockRejectedValueOnce(new Error("Network unavailable"))
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
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current.fetchedAt).toBe("2026-05-04T12:00:00.000Z");

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.current.fetchedAt).toBe("2026-05-05T00:25:00.000Z");
    unmount();
  });

  it("applies SSE-triggered refetches while hidden so background tabs stay current", async () => {
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
        source: "email_triage",
        reason: "email_triage_queued",
        state: "current",
      });
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current.fetchedAt).toBe("2026-05-05T00:25:00.000Z");

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
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

  it("ignores a slower older request so it cannot clobber a newer one (request sequencing)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveOlder;
    let resolveNewer;
    const olderFetch = new Promise((resolve) => { resolveOlder = resolve; });
    const newerFetch = new Promise((resolve) => { resolveNewer = resolve; });
    getCurrentDashboard
      .mockResolvedValueOnce(currentPayload) // initial mount load
      .mockReturnValueOnce(olderFetch) // SSE-driven runEventRefetch (issued first)
      .mockReturnValueOnce(newerFetch); // refreshNow loadCurrent (issued second)

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);

    // Older request starts via SSE, then a newer request starts concurrently
    // via an explicit refresh (loadCurrent has no in-flight guard).
    await act(async () => {
      FakeEventSource.instances[0].emit("dashboard-current-changed", { source: "calendar" });
    });
    let refreshPromise;
    await act(async () => {
      refreshPromise = result.current.liveData.refreshNow();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);

    const fresh = { ...currentPayload, weather: { temp: 80, icon: "Sun" }, fetchedAt: "2026-05-05T01:00:00.000Z" };
    const stale = { ...currentPayload, weather: { temp: 60, icon: "Cloud" }, fetchedAt: "2026-05-05T00:00:00.000Z" };

    // Newer request resolves first with fresh data.
    await act(async () => {
      resolveNewer(fresh);
      await refreshPromise;
    });
    expect(result.current.liveData.liveWeather).toEqual({ temp: 80, icon: "Sun" });

    // Older request resolves last with stale data — it must NOT overwrite the fresh data.
    await act(async () => {
      resolveOlder(stale);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.liveData.liveWeather).toEqual({ temp: 80, icon: "Sun" });

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
          upcoming: [{ id: "deadline-live" }],
          stats: { total: 1 },
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
    expect(result.current.briefingData.briefing.deadlines.upcoming).toEqual([{ id: "deadline-1" }]);
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.briefingData.briefing.deadlines.upcoming).toEqual([{ id: "deadline-live" }]);
    expect(result.current.refreshing).toBe(false);
    unmount();
  });
});
