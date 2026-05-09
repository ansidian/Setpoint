import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";

const mocks = vi.hoisted(() => ({
  autoRefreshArgs: null,
  invalidateCalendarRange: vi.fn(),
  markCalendarRangeStale: vi.fn(),
  refreshCalendarRangeInPlace: vi.fn(),
  markCalendarDomainRangeStale: vi.fn(),
  currentRefreshNow: vi.fn(),
  handleQuickRefresh: vi.fn(),
  activeSnapshotRefresh: vi.fn(),
  activeSnapshotSync: vi.fn(),
  getCalendarDeadlines: vi.fn(),
  getCalendarDeadlinesRange: vi.fn(),
  getCalendarBillsRange: vi.fn(),
  dashboardEventHandler: null,
  handleDashboardEvent: vi.fn(),
  handleCalendarSnapshot: vi.fn(),
  handleTaskCompleted: vi.fn(),
  briefing: null,
  liveData: null,
  latestShellProps: null,
}));

vi.mock("../api", () => ({
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  getCalendarDeadlinesRange: mocks.getCalendarDeadlinesRange,
  getCalendarBillsRange: mocks.getCalendarBillsRange,
}));

vi.mock("../hooks/useCalendarRange", () => ({
  default: () => ({
    invalidate: mocks.invalidateCalendarRange,
    markStale: mocks.markCalendarRangeStale,
    refreshRangeInPlace: mocks.refreshCalendarRangeInPlace,
  }),
}));

vi.mock("../hooks/useCalendarDomainRange", () => ({
  default: () => ({
    data: null,
    ensureRange: vi.fn(),
    markStale: mocks.markCalendarDomainRangeStale,
    loading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useCurrentDashboard", () => ({
  default: (options = {}) => {
    mocks.dashboardEventHandler = options.onDashboardEvent;
    const liveData = mocks.liveData || {
      allSchedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "",
      actualConfigured: false,
      refreshNow: mocks.currentRefreshNow,
    };
    return {
      liveData,
      activeSnapshot: {
        snapshot: null,
        loading: false,
        error: null,
        refresh: mocks.activeSnapshotRefresh,
        sync: mocks.activeSnapshotSync,
      },
      briefingData: {
        loading: false,
        error: null,
        briefing: mocks.briefing,
        lastQuickRefreshAt: null,
        handleQuickRefresh: mocks.handleQuickRefresh,
      },
    };
  },
}));

vi.mock("../hooks/useAutoRefresh", () => ({
  default: (args) => {
    mocks.autoRefreshArgs = args;
  },
}));

vi.mock("../hooks/useNotifications", () => ({
  default: () => {},
}));

vi.mock("../hooks/useTriageNotificationSounds", () => ({
  default: () => ({
    handleDashboardEvent: mocks.handleDashboardEvent,
    handleCalendarSnapshot: mocks.handleCalendarSnapshot,
    handleTaskCompleted: mocks.handleTaskCompleted,
  }),
}));

vi.mock("../components/dashboard/RedesignShell", () => ({
  DashboardBody: () => null,
  RedesignShell: (props) => {
    mocks.latestShellProps = props;
    return (
      <div>
        <button type="button" onClick={props.onQuickRefresh}>Sync now</button>
        <div data-testid="bills-pending">{String(!!props.calendarBillsData?.pendingUpdate)}</div>
      </div>
    );
  },
}));

vi.mock("../components/shared/EmptyStateSplash", () => ({
  default: function EmptyStateSplashMock({ actions }) {
    return <div data-testid="empty-state-splash">{actions}</div>;
  },
}));

describe("Dashboard refresh wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
    mocks.autoRefreshArgs = null;
    mocks.invalidateCalendarRange.mockReset();
    mocks.markCalendarRangeStale.mockReset();
    mocks.refreshCalendarRangeInPlace.mockReset();
    mocks.markCalendarDomainRangeStale.mockReset();
    mocks.currentRefreshNow.mockReset();
    mocks.currentRefreshNow.mockResolvedValue(null);
    mocks.handleQuickRefresh.mockReset();
    mocks.activeSnapshotRefresh.mockReset();
    mocks.activeSnapshotSync.mockReset();
    mocks.getCalendarDeadlines.mockReset();
    mocks.getCalendarDeadlines.mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
    mocks.dashboardEventHandler = null;
    mocks.handleDashboardEvent.mockReset();
    mocks.handleCalendarSnapshot.mockReset();
    mocks.handleTaskCompleted.mockReset();
    mocks.briefing = null;
    mocks.liveData = null;
    mocks.latestShellProps = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps timer refresh from invalidating calendar range while reconciling current data", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    mocks.autoRefreshArgs.onQuickRefresh();

    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotRefresh).not.toHaveBeenCalled();
    expect(mocks.currentRefreshNow).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotSync).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).not.toHaveBeenCalled();
    expect(mocks.getCalendarDeadlines).not.toHaveBeenCalled();
    expect(mocks.markCalendarDomainRangeStale).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).toHaveBeenCalledTimes(1);
    expect(mocks.refreshCalendarRangeInPlace).not.toHaveBeenCalled();
    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotSync).toHaveBeenCalledTimes(2);
    expect(mocks.getCalendarDeadlines).toHaveBeenCalledTimes(1);
    expect(mocks.markCalendarDomainRangeStale).toHaveBeenCalledTimes(2);
  });

  it("maps the R hotkey to Sync now", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    fireEvent.keyDown(window, { key: "r" });

    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotSync).toHaveBeenCalledTimes(1);
  });

  it("updates the auto-refresh cooldown timestamp after timer sync", async () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    expect(mocks.autoRefreshArgs.lastQuickRefreshAt).toBeNull();

    await act(async () => {
      await mocks.autoRefreshArgs.onQuickRefresh();
    });

    expect(mocks.autoRefreshArgs.lastQuickRefreshAt).toBe(new Date("2026-05-04T12:00:00.000Z").getTime());
  });

  it("marks Bills range data stale after a Bills dashboard-current event", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    act(() => {
      mocks.dashboardEventHandler?.({
        source: "bills",
        reason: "maintenance_refreshed",
        state: "current",
      });
    });

    expect(mocks.handleDashboardEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: "bills",
      reason: "maintenance_refreshed",
    }));
    expect(mocks.markCalendarDomainRangeStale).toHaveBeenCalledTimes(1);
  });

  it("clears the Bills pending snapshot once current-data refresh settles", () => {
    mocks.briefing = { weather: null, calendar: [], ctm: {}, todoist: {}, emails: { accounts: [] } };
    mocks.liveData = {
      allSchedules: [{ id: "bill-1", payee: "Power" }],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "https://actual.example.test",
      actualConfigured: true,
      lastFetched: "2026-05-04T12:00:00.000Z",
      refreshNow: mocks.currentRefreshNow,
      providerHealth: {
        currentData: {
          sources: [{ key: "bills_current", state: "refreshing" }],
        },
      },
    };
    const { rerender } = render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    act(() => {
      mocks.latestShellProps.loadCalendarBills({ force: true });
    });
    expect(mocks.latestShellProps.calendarBillsData?.pendingUpdate).toBe(true);

    mocks.liveData = {
      ...mocks.liveData,
      lastFetched: "2026-05-04T12:00:02.000Z",
      providerHealth: {
        currentData: {
          sources: [{ key: "bills_current", state: "current" }],
        },
      },
    };
    rerender(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    expect(mocks.latestShellProps.calendarBillsData?.pendingUpdate).toBe(false);
  });
});
