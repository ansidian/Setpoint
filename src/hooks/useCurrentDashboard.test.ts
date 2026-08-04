import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CurrentDashboardResponse } from "../../shared/types/dashboard";

import useCurrentDashboard from "./useCurrentDashboard";

const getActiveSnapshotMock = vi.fn();
const getCurrentDashboardMock = vi.fn();
const requestCurrentDashboardRefreshMock = vi.fn();
const syncCurrentDashboardMock = vi.fn();
const getCurrentDashboard = getCurrentDashboardMock;
const requestCurrentDashboardRefresh = requestCurrentDashboardRefreshMock;
const syncCurrentDashboard = syncCurrentDashboardMock;

function installDashboardApiBoundary(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input);
    const handler = path === "/api/briefing/snapshot/active"
      ? getActiveSnapshotMock
      : path === "/api/dashboard/current"
        ? getCurrentDashboardMock
        : path === "/api/dashboard/current/refresh"
          ? requestCurrentDashboardRefreshMock
          : path === "/api/dashboard/current/sync"
            ? syncCurrentDashboardMock
            : null;
    if (!handler) throw new Error(`Unexpected dashboard test request: ${path}`);
    const body = await handler();
    return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
  });
}

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
    installDashboardApiBoundary();
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

  it("loads the current endpoint into briefing, live data, and active snapshot adapters", async () => {
    const { result, unmount } = renderHook(() => useCurrentDashboard());

    await act(async () => {});

    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(1);
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
    getCurrentDashboardMock
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
    expect(firstCurrent!.contentKey).toBe("ck-1");

    await act(async () => {
      await result.current.refresh();
    });
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(2);
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
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(2);
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(requestCurrentDashboardRefresh.mock.calls).toHaveLength(0);
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(syncCurrentDashboard.mock.calls).toHaveLength(0);

    await act(async () => {
      await result.current.activeSnapshot.sync();
    });
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(requestCurrentDashboardRefresh.mock.calls).toHaveLength(1);
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(syncCurrentDashboard.mock.calls).toHaveLength(0);
    expect(result.current.liveData.liveWeather).toEqual({ temp: 80, icon: "Sun" });
    expect(result.current.activeSnapshot.snapshot!.snapshot).toEqual({ id: 99 });

    await act(async () => {
      await result.current.forceSync();
    });
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(syncCurrentDashboard.mock.calls).toHaveLength(1);
    expect(result.current.liveData.liveWeather).toEqual({ temp: 85, icon: "Sun" });
    expect(result.current.activeSnapshot.snapshot!.snapshot).toEqual({ id: 100 });

    unmount();
  });

  it("polls current dashboard briefly after manual sync while work is active", async () => {
    vi.useFakeTimers();
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce({
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
    getCurrentDashboardMock
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

    let syncPromise!: Promise<CurrentDashboardResponse | null>;
    await act(async () => {
      syncPromise = result.current.activeSnapshot.sync();
    });
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(requestCurrentDashboardRefresh.mock.calls).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await syncPromise;
    });

    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(2);
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
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce(activePayload);
    const pollTimes: number[] = [];
    let startedAt = 0;
    getCurrentDashboardMock
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
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce({
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
    getCurrentDashboardMock.mockImplementation(async () => {
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

    let syncPromise!: Promise<CurrentDashboardResponse | null>;
    await act(async () => {
      syncPromise = result.current.activeSnapshot.sync();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await syncPromise;
    });

    expect(result.current.current!.fetchedAt).toBe("2026-05-05T00:40:00.000Z");
    expect(result.current.liveData.allSchedules).toEqual([{ id: "water", payee: "SGV Water" }]);
    unmount();
  });

  it("does not poll after manual sync when no work was scheduled", async () => {
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce({
      ...currentPayload,
      refresh: { mode: "manual", scheduled: [], skipped: [{ key: "weather_current", reason: "fresh" }] },
    });
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      await result.current.activeSnapshot.sync();
    });

    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(requestCurrentDashboardRefresh.mock.calls).toHaveLength(1);
    // test-architecture: allow-boundary-interaction -- Dashboard refresh and sync cross authenticated HTTP boundaries; request admission and negative writes are not fully exposed by final hook state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(1);
    unmount();
  });
});
