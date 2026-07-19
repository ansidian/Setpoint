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

    expect(getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.briefingData.briefing!.deadlines.upcoming).toEqual([{ id: "deadline-live" }]);
    expect(result.current.refreshing).toBe(false);

    unmount();
  });

  it("passes dashboard-current SSE payloads to event consumers while refetching", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onDashboardEvent = vi.fn();
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload);

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
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", payload);
      await Promise.resolve();
    });

    expect(onDashboardEvent).toHaveBeenCalledWith(payload);
    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("logs SSE receipt-to-state-application timing for the accepted response", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload);
    getActiveSnapshotMock.mockResolvedValueOnce({
      ...currentPayload.activeSnapshot,
      snapshot: { id: 77 },
    });

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "email_triage",
        reason: "email_triage_finalized",
        details: {
          eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
        },
      });
      await Promise.resolve();
    });

    expect(result.current.current!.activeSnapshot.snapshot!.id).toBe(77);
    const timingLine = logSpy.mock.calls
      .map(([line]) => line)
      .find((line) => String(line).startsWith("[EA Timing] "));
    expect(timingLine).toBeTruthy();
    expect(JSON.parse(timingLine.slice("[EA Timing] ".length))).toMatchObject({
      event: "dashboard-event-refetch",
      scope: "active_snapshot",
      source: "email_triage",
      reason: "email_triage_finalized",
      eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
      status: "ok",
      ms: expect.any(Number),
    });
    logSpy.mockRestore();
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
    getCurrentDashboardMock.mockResolvedValueOnce(currentPayload);
    getActiveSnapshotMock.mockResolvedValueOnce(queuedSnapshot);

    const { result, unmount } = renderHook(() => useCurrentDashboard());
    await act(async () => {});

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
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

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.activeSnapshot.snapshot!.lanes.queued).toEqual(queuedSnapshot.lanes.queued);
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

    expect(getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
    unmount();
  });
});
