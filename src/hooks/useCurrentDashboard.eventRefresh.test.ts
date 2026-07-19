import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CurrentDashboardResponse } from "../../shared/types/dashboard";
import type { ActiveSnapshotView } from "../../shared/types/snapshots";

vi.mock("../api", () => ({
  getActiveSnapshot: vi.fn(),
  getCurrentDashboard: vi.fn(),
  requestCurrentDashboardRefresh: vi.fn(),
  syncCurrentDashboard: vi.fn(),
}));

const {
  getActiveSnapshot,
  getCurrentDashboard,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} = await import("../api");
const { default: useCurrentDashboard } = await import("./useCurrentDashboard");

const getActiveSnapshotMock = vi.mocked(getActiveSnapshot) as unknown as ReturnType<typeof vi.fn>;
const getCurrentDashboardMock = vi.mocked(getCurrentDashboard) as unknown as ReturnType<typeof vi.fn>;
const requestCurrentDashboardRefreshMock = vi.mocked(requestCurrentDashboardRefresh) as unknown as ReturnType<typeof vi.fn>;
const syncCurrentDashboardMock = vi.mocked(syncCurrentDashboard) as unknown as ReturnType<typeof vi.fn>;

type FakeEventSourceListener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readonly url: string;
  readonly listeners = new Map<string, Set<FakeEventSourceListener>>();
  closed = false;
  readyState = FakeEventSource.OPEN;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: FakeEventSourceListener): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeEventSourceListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) || []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  // Simulate the browser firing onerror. `readyState` reflects what the browser
  // would set: CLOSED for a terminal failure (e.g. a 401 handshake), CONNECTING
  // for a transient drop the browser will auto-retry.
  emitError(readyState = FakeEventSource.CLOSED): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

function setDocumentHidden(hidden: boolean): void {
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
} as unknown as CurrentDashboardResponse;

describe("useCurrentDashboard", () => {
  beforeEach(() => {
    setDocumentHidden(false);
    FakeEventSource.instances = [];
    getActiveSnapshotMock.mockReset().mockResolvedValue(currentPayload.activeSnapshot);
    getCurrentDashboardMock.mockReset().mockResolvedValue(currentPayload);
    requestCurrentDashboardRefreshMock.mockReset().mockResolvedValue({
      ...currentPayload,
      weather: { temp: 80, icon: "Sun" },
      activeSnapshot: { ...currentPayload.activeSnapshot, snapshot: { id: 99 } },
      fetchedAt: "2026-05-04T12:05:00.000Z",
    });
    syncCurrentDashboardMock.mockReset().mockResolvedValue({
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

  it("catches up when visible if an SSE-triggered hidden refetch fails", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboardMock
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
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "todoist",
        reason: "webhook_received",
        state: "needs_sync",
      });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current!.fetchedAt).toBe("2026-05-04T12:00:00.000Z");

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.current!.fetchedAt).toBe("2026-05-05T00:25:00.000Z");
    unmount();
  });

  it("applies SSE-triggered refetches while hidden so background tabs stay current", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload);
    getActiveSnapshotMock.mockResolvedValueOnce({
      ...currentPayload.activeSnapshot,
      snapshot: { id: 88 },
    });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    setDocumentHidden(true);
    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "email_triage",
        reason: "email_triage_queued",
        state: "current",
      });
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.current!.activeSnapshot.snapshot!.id).toBe(88);

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("coalesces dashboard-current events that arrive during an in-flight refetch", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveFirstEventFetch!: (value: CurrentDashboardResponse) => void;
    const firstEventFetch = new Promise<CurrentDashboardResponse>((resolve) => {
      resolveFirstEventFetch = resolve;
    });
    getCurrentDashboardMock
      .mockResolvedValueOnce(currentPayload)
      .mockReturnValueOnce(firstEventFetch)
      .mockResolvedValueOnce({
        ...currentPayload,
        fetchedAt: "2026-05-05T00:30:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "todoist" });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "todoist" });
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
    expect(result.current.current!.fetchedAt).toBe("2026-05-05T00:30:00.000Z");
    unmount();
  });

  it("keeps a queued full-current scope when a later email event arrives", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveSnapshot!: (value: ActiveSnapshotView) => void;
    getActiveSnapshotMock.mockReturnValueOnce(new Promise<ActiveSnapshotView>((resolve) => {
      resolveSnapshot = resolve;
    }));
    getCurrentDashboardMock
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        weather: { temp: 81, icon: "Sun" },
        fetchedAt: "2026-05-05T00:31:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "email_triage" });
      await Promise.resolve();
    });
    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "todoist" });
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "email_triage" });
      await Promise.resolve();
    });

    await act(async () => {
      resolveSnapshot(currentPayload.activeSnapshot);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current!.weather!.temp).toBe(81);
    unmount();
  });

  it("falls back exactly once to the full current envelope when snapshot refresh fails", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getActiveSnapshotMock.mockRejectedValueOnce(new Error("snapshot unavailable"));
    getCurrentDashboardMock
      .mockResolvedValueOnce(currentPayload)
      .mockResolvedValueOnce({
        ...currentPayload,
        activeSnapshot: {
          ...currentPayload.activeSnapshot,
          snapshot: { id: 101 },
        },
        fetchedAt: "2026-05-05T00:32:00.000Z",
      });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "email_triage" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.current!.activeSnapshot.snapshot!.id).toBe(101);
    unmount();
  });

  it("ignores a slower older request so it cannot clobber a newer one (request sequencing)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let resolveOlder!: (value: CurrentDashboardResponse) => void;
    let resolveNewer!: (value: CurrentDashboardResponse) => void;
    const olderFetch = new Promise<CurrentDashboardResponse>((resolve) => { resolveOlder = resolve; });
    const newerFetch = new Promise<CurrentDashboardResponse>((resolve) => { resolveNewer = resolve; });
    getCurrentDashboardMock
      .mockResolvedValueOnce(currentPayload) // initial mount load
      .mockReturnValueOnce(olderFetch) // SSE-driven runEventRefetch (issued first)
      .mockReturnValueOnce(newerFetch); // refreshNow loadCurrent (issued second)

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);

    // Older request starts via SSE, then a newer request starts concurrently
    // via an explicit refresh (loadCurrent has no in-flight guard).
    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "calendar" });
    });
    let refreshPromise!: Promise<CurrentDashboardResponse | null>;
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
    expect(logSpy.mock.calls.filter(([line]) => String(line).includes("dashboard-event-refetch"))).toHaveLength(0);

    logSpy.mockRestore();
    unmount();
  });

  it("polls silently after an SSE refetch schedules current-data refresh work", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboardMock
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
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "todoist",
        reason: "sync_settled",
        state: "current",
      });
      await Promise.resolve();
    });
    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.briefingData.briefing!.deadlines.upcoming).toEqual([{ id: "deadline-1" }]);
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(getCurrentDashboard).toHaveBeenCalledTimes(3);
    expect(result.current.briefingData.briefing!.deadlines.upcoming).toEqual([{ id: "deadline-live" }]);
    expect(result.current.refreshing).toBe(false);
    unmount();
  });
});
