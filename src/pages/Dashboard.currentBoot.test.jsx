import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";

const mocks = vi.hoisted(() => ({
  getCurrentDashboard: vi.fn(),
  syncCurrentDashboard: vi.fn(),
  getActiveSnapshot: vi.fn(),
  syncActiveSnapshot: vi.fn(),
  getSettings: vi.fn(),
  getCalendarDeadlines: vi.fn(),
}));

vi.mock("../api", () => ({
  getCurrentDashboard: mocks.getCurrentDashboard,
  syncCurrentDashboard: mocks.syncCurrentDashboard,
  getActiveSnapshot: mocks.getActiveSnapshot,
  syncActiveSnapshot: mocks.syncActiveSnapshot,
  getSettings: mocks.getSettings,
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  getCalendarDeadlinesRange: vi.fn(),
  getCalendarBillsRange: vi.fn(),
}));

vi.mock("../hooks/useCalendarRange", () => ({
  default: () => ({
    ensureRange: vi.fn().mockResolvedValue([]),
    markStale: vi.fn(),
    refreshRangeInPlace: vi.fn(),
  }),
}));

vi.mock("../hooks/useCalendarDomainRange", () => ({
  default: () => ({
    data: null,
    ensureRange: vi.fn(),
    markStale: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useAutoRefresh", () => ({ default: () => {} }));
vi.mock("../hooks/useNotifications", () => ({ default: () => {} }));

vi.mock("../components/dashboard/RedesignShell", () => ({
  RedesignShell: ({ bd, liveData, activeSnapshot }) => (
    <div data-testid="dashboard-shell">
      <span data-testid="weather-temp">{liveData.liveWeather?.temp}</span>
      <span data-testid="event-count">{bd.briefing?.calendar?.length ?? 0}</span>
      <span data-testid="bill-count">{liveData.liveBills?.length ?? 0}</span>
      <span data-testid="snapshot-id">{activeSnapshot?.snapshot?.snapshot?.id}</span>
    </div>
  ),
  DashboardBody: () => null,
}));

const currentPayload = {
  weather: { temp: 72, icon: "Sun" },
  calendar: [{ id: "event-1", title: "Focus" }],
  deadlines: {
    ctm: { upcoming: [], stats: { total: 0 } },
    todoist: { upcoming: [], stats: { total: 0 } },
  },
  bills: [{ id: "bill-1", payee: "Power" }],
  allSchedules: [],
  payeeMap: {},
  actualConfigured: true,
  actualBudgetUrl: "https://actual.example.test",
  activeSnapshot: {
    snapshot: { id: 42 },
    lanes: { needs_attention: [], fyi: [], noise: [] },
    carryover: [],
    filters: { accounts: [], categories: [] },
  },
  providerHealth: { currentData: { state: "current", sources: [] } },
  fetchedAt: "2026-05-04T12:00:00.000Z",
};

describe("Dashboard current boot", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    mocks.getCurrentDashboard.mockReset().mockResolvedValue(currentPayload);
    mocks.syncCurrentDashboard.mockReset().mockResolvedValue(currentPayload);
    mocks.getActiveSnapshot.mockReset().mockRejectedValue(new Error("snapshot route should not load separately"));
    mocks.syncActiveSnapshot.mockReset().mockRejectedValue(new Error("snapshot sync route should not load separately"));
    mocks.getSettings.mockReset().mockResolvedValue({});
    mocks.getCalendarDeadlines.mockReset().mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("boots from the current dashboard endpoint without legacy briefing, live, or separate snapshot calls", async () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-shell")).toBeTruthy());

    expect(screen.getByTestId("weather-temp").textContent).toBe("72");
    expect(screen.getByTestId("event-count").textContent).toBe("1");
    expect(screen.getByTestId("bill-count").textContent).toBe("1");
    expect(screen.getByTestId("snapshot-id").textContent).toBe("42");
    expect(mocks.getCurrentDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getActiveSnapshot).not.toHaveBeenCalled();
  });
});
