import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CurrentDashboardResponse } from "../../shared/types/dashboard";

import useCurrentDashboard from "./useCurrentDashboard";
import { ensureMetadataLoaded, invalidateActualMetadata, type ActualMetadata } from "../lib/actualMetadata";

const getActiveSnapshotMock = vi.fn();
const getCurrentDashboardMock = vi.fn();
const requestCurrentDashboardRefreshMock = vi.fn();
const syncCurrentDashboardMock = vi.fn();
const getActiveSnapshot = getActiveSnapshotMock;
const getCurrentDashboard = getCurrentDashboardMock;
let actualMetadataResponse = {
  accounts: [],
  payees: [{ id: "payee-old", name: "Old Payee" }],
  categories: [],
};

function installDashboardApiBoundary(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/briefing/actual/metadata") {
      return { ok: true, status: 200, json: () => Promise.resolve(actualMetadataResponse) } as Response;
    }
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

function loadActualMetadata() {
  return new Promise<ActualMetadata>((resolve) => {
    ensureMetadataLoaded(resolve);
  });
}

describe("useCurrentDashboard", () => {
  beforeEach(() => {
    invalidateActualMetadata();
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
    actualMetadataResponse = {
      accounts: [],
      payees: [{ id: "payee-old", name: "Old Payee" }],
      categories: [],
    };
  });

  afterEach(() => {
    invalidateActualMetadata();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setDocumentHidden(false);
    vi.useRealTimers();
  });

  it("never reports healthy before a successful dashboard health read", async () => {
    getCurrentDashboardMock.mockRejectedValue(new Error("offline"));
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    expect(result.current.systemStatus?.state).toBe("checking");
    await act(async () => {});
    expect(result.current.systemStatus?.state).toBe("unavailable");
    expect(result.current.liveData.systemStatus?.sources[0]?.key).toBe("dashboard_connection");
    unmount();
  });

  it("retains saved data but reports a failed background health read until a full read succeeds", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    getCurrentDashboardMock.mockRejectedValue(new Error("unreachable"));
    await act(async () => { FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "calendar" }); });
    expect(result.current.liveData.liveWeather).toEqual(currentPayload.weather);
    expect(result.current.systemStatus?.state).toBe("degraded");
    await act(async () => { FakeEventSource.instances[0]!.emit("dashboard-current-changed", { source: "email_triage" }); });
    expect(result.current.systemStatus?.state).toBe("degraded");
    getCurrentDashboardMock.mockResolvedValue(currentPayload);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.systemStatus?.state).toBe("current");
    unmount();
  });

  it("reports interrupted live updates and revalidates health when the stream reconnects", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    const source = FakeEventSource.instances[0]!;
    await act(async () => { source.emitError(FakeEventSource.CONNECTING); });
    expect(result.current.systemStatus?.sources[0]).toMatchObject({ key: "dashboard_connection", state: "degraded" });
    let finishReconnect!: (value: unknown) => void;
    getCurrentDashboardMock.mockImplementation(() => new Promise((resolve) => { finishReconnect = resolve; }));
    await act(async () => { source.emit("open"); });
    expect(result.current.systemStatus?.state).toBe("degraded");
    await act(async () => { finishReconnect({
      ...currentPayload,
      systemStatus: { ...currentPayload.systemStatus, state: "needs_sync" },
      contentKey: "reconnected-health",
    }); });
    expect(result.current.systemStatus?.state).toBe("needs_sync");
    expect(result.current.systemStatus?.sources.some((entry) => entry.key === "dashboard_connection")).toBe(false);
    unmount();
  });

  it("reports browser offline without dropping saved data and rechecks on returning online", async () => {
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(result.current.systemStatus?.sources[0]?.message).toContain("offline");
    expect(result.current.liveData.liveWeather).toEqual(currentPayload.weather);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(result.current.systemStatus?.state).toBe("current");
    unmount();
  });

  it("ages source freshness in an idle tab while recording successful checks of identical content", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    getCurrentDashboardMock.mockResolvedValue({
      ...currentPayload,
      contentKey: "unchanged-content",
      systemStatus: {
        state: "current", generatedAt: "2026-09-06T12:00:00Z",
        sources: [{ key: "weather", label: "Weather", state: "current", severity: "none", lastSuccessAt: "2026-09-06T12:00:00Z", expiresAt: "2026-09-06T12:01:00Z", impact: "Conditions and forecast may be out of date." }],
      },
    });
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    const envelope = result.current.current;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await result.current.refresh(); });
    expect(result.current.current).toBe(envelope);
    expect(result.current.systemStatus?.generatedAt).toBe("2026-09-06T12:00:30.000Z");
    expect(result.current.systemStatus?.state).toBe("current");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.systemStatus?.state).toBe("needs_sync");
    expect(result.current.systemStatus?.sources[0]?.message).toBe("Conditions and forecast may be out of date.");
    expect(result.current.liveData.systemStatus?.sources[0]?.lastSuccessAt).toBe("2026-09-06T12:00:00Z");
    unmount();
  });

  it("invalidates the shared Actual metadata cache when bills change over SSE", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    expect((await loadActualMetadata()).payees).toEqual([{ id: "payee-old", name: "Old Payee" }]);

    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});
    actualMetadataResponse = {
      accounts: [],
      payees: [{ id: "payee-fresh", name: "Fresh Payee" }],
      categories: [],
    };

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "bills",
        reason: "mirror_refreshed",
        state: "current",
      });
      await Promise.resolve();
    });

    expect((await loadActualMetadata()).payees).toEqual([{ id: "payee-fresh", name: "Fresh Payee" }]);
    unmount();
  });

  it("subscribes to dashboard-current events and silently refetches current data", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    getCurrentDashboardMock
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
    expect(FakeEventSource.instances[0]!.url).toBe("/api/dashboard/current/events");

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "todoist",
        reason: "sync_settled",
        state: "current",
      });
      await Promise.resolve();
    });

    // test-architecture: allow-boundary-interaction -- Dashboard and snapshot loading cross browser HTTP boundaries; source-specific admission cannot be inferred from the merged final state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(2);
    expect(result.current.briefingData.briefing!.deadlines.upcoming).toEqual([{ id: "deadline-live" }]);
    expect(result.current.refreshing).toBe(false);

    unmount();
  });

  it("passes dashboard-current SSE payloads to event consumers while refetching", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const dashboardEvents: unknown[] = [];
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload);

    const { unmount } = renderHook(() => useCurrentDashboard({ onDashboardEvent: (event) => dashboardEvents.push(event) }));
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
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", payload);
      await Promise.resolve();
    });

    expect(dashboardEvents).toEqual([payload]);
    // test-architecture: allow-boundary-interaction -- Dashboard and snapshot loading cross browser HTTP boundaries; source-specific admission cannot be inferred from the merged final state.
    expect(getCurrentDashboard.mock.calls).toHaveLength(1);
    // test-architecture: allow-boundary-interaction -- Dashboard and snapshot loading cross browser HTTP boundaries; source-specific admission cannot be inferred from the merged final state.
    expect(getActiveSnapshot.mock.calls).toHaveLength(1);
    unmount();
  });

  it("closes the dashboard-current event stream on unmount and skips it when disabled", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

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
    const source = FakeEventSource.instances[0]!;

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

    const source = FakeEventSource.instances[0]!;

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

    expect(FakeEventSource.instances).toHaveLength(0);
    unmount();
  });
});
