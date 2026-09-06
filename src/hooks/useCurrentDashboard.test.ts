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
let dashboardRequests: Array<{ path: string; method: string; body: unknown }> = [];

function installDashboardApiBoundary(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    dashboardRequests.push({ path, method: options?.method || "GET", body: options?.body ? JSON.parse(String(options.body)) : null });
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
    dashboardRequests = [];
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

  function calendarRetryPayload(state: "current" | "degraded" | "needs_reauth") {
    return {
      ...currentPayload,
      fetchedAt: state === "current" ? "2026-05-04T12:11:00.000Z" : state === "needs_reauth" ? "2026-05-04T12:12:00.000Z" : "2026-05-04T12:10:00.000Z",
      systemStatus: {
        state: state === "current" ? "current" : "degraded",
        generatedAt: "2026-05-04T12:10:00.000Z",
        sources: [{
          key: "calendar", label: "Calendar", state, severity: state === "current" ? "none" : "warning",
          lastSuccessAt: currentPayload.fetchedAt,
          message: state === "needs_reauth" ? "Reconnect your calendar account." : "Saved events remain visible.",
          ...(state === "needs_reauth" ? {} : { retrySource: "calendar_current" }),
        }],
      },
      refresh: { mode: "manual", scheduled: [], skipped: [] },
    } as CurrentDashboardResponse;
  }

  it("retries only the selected source and applies its completed response without a follow-up read", async () => {
    getCurrentDashboardMock.mockResolvedValueOnce(calendarRetryPayload("degraded"));
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce(calendarRetryPayload("current"));
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    await act(async () => { await result.current.retrySource("calendar_current"); });

    expect(result.current.sourceRetry).toEqual({ source: "calendar_current", state: "success", message: "Calendar is up to date." });
    expect(result.current.systemStatus?.sources[0]?.state).toBe("current");
    expect(result.current.refreshing).toBe(false);
    // The authenticated HTTP protocol must select one provider and avoid a GET
    // that could schedule unrelated work after this completed targeted response.
    expect(dashboardRequests).toEqual([
      { path: "/api/dashboard/current", method: "GET", body: null },
      { path: "/api/dashboard/current/refresh", method: "POST", body: { source: "calendar_current" } },
    ]);
    unmount();
  });

  it.each(["degraded", "needs_reauth"] as const)("reports %s as a failed recovery even when the HTTP request succeeds", async (state) => {
    getCurrentDashboardMock.mockResolvedValueOnce(calendarRetryPayload("degraded"));
    const response = calendarRetryPayload(state);
    requestCurrentDashboardRefreshMock.mockResolvedValueOnce(response);
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    await act(async () => { await result.current.retrySource("calendar_current"); });

    expect(result.current.sourceRetry).toEqual({ source: "calendar_current", state: "error", message: state === "needs_reauth" ? "Reconnect Calendar to try again." : "Calendar still needs attention." });
    expect(result.current.liveData.liveCalendar).toEqual(currentPayload.calendar);
    unmount();
  });

  it("keeps saved data and page loading state intact when a source retry fails to connect", async () => {
    requestCurrentDashboardRefreshMock.mockRejectedValueOnce(new Error("Network unavailable"));
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    await act(async () => { await result.current.retrySource("calendar_current"); });

    expect(result.current.sourceRetry).toMatchObject({ source: "calendar_current", state: "error" });
    expect(result.current.sourceRetry?.message).toBe("Could not check for updates. Try again.");
    expect(result.current.current).toEqual(currentPayload);
    expect(result.current.error).toBeNull();
    expect(result.current.briefingData.loaded).toBe(true);
    unmount();
  });

  it("replaces a failed retry receipt on a later full health read, including identical content, but not a snapshot read", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboardMock.mockResolvedValue({ ...currentPayload, contentKey: "unchanged" });
    requestCurrentDashboardRefreshMock.mockRejectedValueOnce(new Error("Network unavailable"));
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    await act(async () => { await result.current.retrySource("calendar_current"); });
    expect(result.current.sourceRetry?.state).toBe("error");
    await act(async () => { FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "email_triage" }); });
    expect(result.current.sourceRetry?.state).toBe("error");
    await act(async () => { await result.current.refresh(); });
    expect(result.current.sourceRetry).toBeNull();
    requestCurrentDashboardRefreshMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => { await result.current.retrySource("calendar_current"); });
    expect(result.current.sourceRetry?.state).toBe("error");
    const previous = result.current.current;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.current).toBe(previous);
    expect(result.current.sourceRetry).toBeNull();
    unmount();
  });

  it("protects the pending retry from older reads, SSE, passive reads, and repeated retries", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveRead!: (data: CurrentDashboardResponse) => void;
    let resolveRetry!: (data: CurrentDashboardResponse) => void;
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload)
      .mockImplementationOnce(() => new Promise<CurrentDashboardResponse>((resolve) => { resolveRead = resolve; }));
    requestCurrentDashboardRefreshMock.mockImplementationOnce(() => new Promise<CurrentDashboardResponse>((resolve) => { resolveRetry = resolve; }));
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    let readPromise!: Promise<CurrentDashboardResponse | null>;
    let retryPromise!: Promise<CurrentDashboardResponse | null>;
    act(() => { readPromise = result.current.refresh(); });
    act(() => { retryPromise = result.current.retrySource("calendar_current"); });
    await act(async () => {
      await result.current.retrySource("weather_current");
      await result.current.refresh();
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "calendar" });
      resolveRead({ ...currentPayload, weather: { temp: 1 } });
      await readPromise;
    });
    expect(result.current.sourceRetry?.state).toBe("pending");
    expect(result.current.liveData.liveWeather).toEqual(currentPayload.weather);
    await act(async () => { resolveRetry(calendarRetryPayload("current")); await retryPromise; });
    expect(result.current.sourceRetry?.state).toBe("success");
    // Negative outbound requests are the contract: SSE/read/repeated-click
    // traffic must not trigger an all-provider refresh around a source retry.
    expect(dashboardRequests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /api/dashboard/current", "GET /api/dashboard/current", "POST /api/dashboard/current/refresh",
    ]);
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
