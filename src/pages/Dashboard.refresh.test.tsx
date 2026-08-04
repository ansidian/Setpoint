import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router";
import Dashboard from "./Dashboard";
import type { CurrentDashboardResponse } from "../../shared/types/dashboard";

const mocks = vi.hoisted(() => ({
  getCurrentDashboard: vi.fn(),
  requestCurrentDashboardRefresh: vi.fn(),
  syncCurrentDashboard: vi.fn(),
  getActiveSnapshot: vi.fn(),
  getCalendarRange: vi.fn(),
  getCalendarDeadlines: vi.fn(),
  getCalendarDeadlinesRange: vi.fn(),
  getCalendarBillsRange: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../api", () => ({
  getCurrentDashboard: mocks.getCurrentDashboard,
  requestCurrentDashboardRefresh: mocks.requestCurrentDashboardRefresh,
  syncCurrentDashboard: mocks.syncCurrentDashboard,
  getActiveSnapshot: mocks.getActiveSnapshot,
  getCalendarRange: mocks.getCalendarRange,
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  getCalendarDeadlinesRange: mocks.getCalendarDeadlinesRange,
  getCalendarBillsRange: mocks.getCalendarBillsRange,
  getSettings: mocks.getSettings,
}));

const initialPayload = {
  weather: { temp: 72, icon: "Sun", summary: "Clear", location: "Los Angeles" },
  calendar: [],
  deadlines: { upcoming: [], stats: null },
  bills: [],
  allSchedules: [],
  payeeMap: {},
  actualConfigured: false,
  actualBudgetUrl: null,
  activeSnapshot: {
    snapshot: { id: 42 },
    lanes: { needs_attention: [], fyi: [], noise: [] },
    carryover: [],
    filters: { accounts: [], categories: [] },
  },
  providerHealth: { currentData: { state: "current", sources: [] } },
  fetchedAt: "2026-05-04T12:00:00.000Z",
} as unknown as CurrentDashboardResponse;

function renderDashboard() {
  return render(
    <BrowserRouter>
      <Dashboard />
    </BrowserRouter>,
  );
}

type EventSourceListener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readonly listeners = new Map<string, Set<EventSourceListener>>();
  readonly url: string;
  readyState = FakeEventSource.OPEN;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventSourceListener) {
    const listeners = this.listeners.get(type) || new Set<EventSourceListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventSourceListener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data: Record<string, unknown>) {
    for (const listener of this.listeners.get(type) || []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  Object.defineProperty(document, "hidden", { configurable: true, value: state === "hidden" });
}

describe("Dashboard refresh behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
    vi.stubGlobal("EventSource", undefined);
    FakeEventSource.instances = [];
    setVisibilityState("visible");
    mocks.getCurrentDashboard.mockReset().mockResolvedValue(initialPayload);
    mocks.requestCurrentDashboardRefresh.mockReset().mockResolvedValue({
      ...initialPayload,
      weather: { temp: 85, icon: "Sun", summary: "Warm", location: "Los Angeles" },
      activeSnapshot: { ...initialPayload.activeSnapshot, snapshot: { id: 99 } },
      fetchedAt: "2026-05-04T12:01:00.000Z",
      refresh: { mode: "manual", scheduled: [], skipped: [] },
    });
    mocks.syncCurrentDashboard.mockReset().mockResolvedValue(initialPayload);
    mocks.getActiveSnapshot.mockReset().mockResolvedValue(initialPayload.activeSnapshot);
    mocks.getCalendarRange.mockReset().mockResolvedValue({ events: [] });
    mocks.getCalendarDeadlines.mockReset().mockResolvedValue({ upcoming: [], stats: null });
    mocks.getCalendarDeadlinesRange.mockReset().mockResolvedValue({ upcoming: [], stats: null });
    mocks.getCalendarBillsRange.mockReset().mockResolvedValue([]);
    mocks.getSettings.mockReset().mockResolvedValue({});
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setVisibilityState("visible");
    vi.useRealTimers();
  });

  it("updates visible data from an automatic focus refresh through the current-data boundary", async () => {
    mocks.getCurrentDashboard.mockResolvedValueOnce(initialPayload).mockResolvedValueOnce({
      ...initialPayload,
      weather: { temp: 74, icon: "Sun", summary: "Clear", location: "Los Angeles" },
      fetchedAt: "2026-05-04T12:05:00.000Z",
    });

    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("72°"));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("74°"));
    expect(mocks.getCurrentDashboard).toHaveBeenCalledTimes(2);
    expect(mocks.requestCurrentDashboardRefresh).not.toHaveBeenCalled();
  });

  it("shows the syncing state and then visible data after Sync now resolves", async () => {
    let resolveRefresh!: (value: CurrentDashboardResponse) => void;
    mocks.requestCurrentDashboardRefresh.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    renderDashboard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy());

    await act(async () => {
      screen.getByRole("button", { name: "Sync now" }).click();
      await Promise.resolve();
    });

    const syncingButton = screen.getByRole("button", { name: "Syncing" }) as HTMLButtonElement;
    expect(syncingButton.disabled).toBe(true);

    await act(async () => {
      resolveRefresh({
        ...initialPayload,
        weather: { temp: 85, icon: "Sun", summary: "Warm", location: "Los Angeles" },
        activeSnapshot: { ...initialPayload.activeSnapshot, snapshot: { id: 99 } },
        fetchedAt: "2026-05-04T12:01:00.000Z",
        refresh: { mode: "manual", scheduled: [], skipped: [] },
      } as unknown as CurrentDashboardResponse);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("85°"));
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.requestCurrentDashboardRefresh).toHaveBeenCalledTimes(1);
  });

  it("updates visible data on the automatic interval through the rendered Dashboard facade", async () => {
    mocks.getCurrentDashboard.mockResolvedValueOnce(initialPayload).mockResolvedValueOnce({
      ...initialPayload,
      weather: { temp: 76, icon: "Sun", summary: "Clear", location: "Los Angeles" },
      fetchedAt: "2026-05-04T12:05:00.000Z",
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("72°"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("76°"));
  });

  it("suppresses hidden focus work and catches up visibly when the tab returns", async () => {
    mocks.getCurrentDashboard.mockResolvedValueOnce(initialPayload).mockResolvedValueOnce({
      ...initialPayload,
      weather: { temp: 78, icon: "Sun", summary: "Clear", location: "Los Angeles" },
      fetchedAt: "2026-05-04T12:06:00.000Z",
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("72°"));

    setVisibilityState("hidden");
    window.dispatchEvent(new Event("focus"));
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("context-weather").textContent).toContain("72°");

    setVisibilityState("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("78°"));
  });

  it("applies an SSE-triggered refresh as a visible Dashboard outcome", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    mocks.getCurrentDashboard.mockResolvedValueOnce(initialPayload).mockResolvedValueOnce({
      ...initialPayload,
      weather: { temp: 81, icon: "Sun", summary: "Warm", location: "Los Angeles" },
      fetchedAt: "2026-05-04T12:07:00.000Z",
    });
    renderDashboard();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0]!.emit("dashboard-current-changed", {
        source: "todoist",
        reason: "webhook_received",
        state: "needs_sync",
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("context-weather").textContent).toContain("81°"));
  });
});
