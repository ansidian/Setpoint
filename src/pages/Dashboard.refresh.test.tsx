import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import type { ReactNode } from "react";
import type { CurrentDashboardEventInput } from "../../shared/types/dashboard";

interface AutoRefreshArgs {
  onQuickRefresh: () => unknown;
  lastQuickRefreshAt: number | null;
}
interface RefreshShellProps {
  onQuickRefresh: () => void;
  calendarBillsData?: { pendingUpdate?: boolean };
  loadCalendarBills: (options?: { force?: boolean }) => void;
}
interface DashboardHookOptions {
  onDashboardEvent?: (event: CurrentDashboardEventInput | null) => void;
}
interface RefreshLiveDataFixture {
  allSchedules: Array<Record<string, unknown>>;
  recentTransactions: unknown[];
  payeeMap: Record<string, string>;
  actualBudgetUrl: string;
  actualConfigured: boolean;
  lastFetched?: string;
  refreshNow: ReturnType<typeof vi.fn>;
  providerHealth?: { currentData?: { sources?: Array<{ key: string; state: string }> } };
  [key: string]: unknown;
}

const mocks = vi.hoisted(() => ({
  autoRefreshArgs: null as AutoRefreshArgs | null,
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
  dashboardEventHandler: null as ((event: CurrentDashboardEventInput | null) => void) | null,
  handleDashboardEvent: vi.fn(),
  handleCalendarSnapshot: vi.fn(),
  handleActiveSnapshot: vi.fn(),
  handleTaskCompleted: vi.fn(),
  briefing: null as Record<string, unknown> | null,
  liveData: null as RefreshLiveDataFixture | null,
  latestShellProps: null as RefreshShellProps | null,
}));

vi.mock("../api", () => ({
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  getCalendarDeadlinesRange: mocks.getCalendarDeadlinesRange,
  getCalendarBillsRange: mocks.getCalendarBillsRange,
}));

vi.mock("../hooks/calendar/useCalendarRange", () => ({
  default: () => ({
    invalidate: mocks.invalidateCalendarRange,
    markStale: mocks.markCalendarRangeStale,
    refreshRangeInPlace: mocks.refreshCalendarRangeInPlace,
  }),
}));

vi.mock("../hooks/calendar/useCalendarDomainRange", () => ({
  default: () => ({
    data: null,
    ensureRange: vi.fn(),
    markStale: mocks.markCalendarDomainRangeStale,
    loading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useCurrentDashboard", () => ({
  default: (options: DashboardHookOptions = {}) => {
    mocks.dashboardEventHandler = options.onDashboardEvent ?? null;
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
  default: (args: AutoRefreshArgs) => {
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
    handleActiveSnapshot: mocks.handleActiveSnapshot,
    handleTaskCompleted: mocks.handleTaskCompleted,
  }),
}));

vi.mock("../components/dashboard/DashboardShell", () => ({
  DashboardBody: () => null,
  DashboardShell: (props: RefreshShellProps) => {
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
  default: function EmptyStateSplashMock({ actions }: { actions: ReactNode }) {
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
    mocks.getCalendarDeadlines.mockResolvedValue({ upcoming: [] });
    mocks.dashboardEventHandler = null;
    mocks.handleDashboardEvent.mockReset();
    mocks.handleCalendarSnapshot.mockReset();
    mocks.handleActiveSnapshot.mockReset();
    mocks.handleTaskCompleted.mockReset();
    mocks.briefing = null;
    mocks.liveData = null;
    mocks.latestShellProps = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses a light current-data fetch for timer refresh without starting a heavy snapshot sync", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    mocks.autoRefreshArgs!.onQuickRefresh();

    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotRefresh).not.toHaveBeenCalled();
    expect(mocks.currentRefreshNow).toHaveBeenCalledTimes(1);
    expect(mocks.activeSnapshotSync).not.toHaveBeenCalled();
    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).not.toHaveBeenCalled();
    expect(mocks.getCalendarDeadlines).not.toHaveBeenCalled();
    expect(mocks.markCalendarDomainRangeStale).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).toHaveBeenCalledTimes(1);
    expect(mocks.refreshCalendarRangeInPlace).not.toHaveBeenCalled();
    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotSync).toHaveBeenCalledTimes(1);
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

    expect(mocks.autoRefreshArgs!.lastQuickRefreshAt).toBeNull();

    await act(async () => {
      await mocks.autoRefreshArgs!.onQuickRefresh();
    });

    expect(mocks.autoRefreshArgs!.lastQuickRefreshAt).toBe(new Date("2026-05-04T12:00:00.000Z").getTime());
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

  it("reloads calendar deadlines after Todoist sync settles", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    act(() => {
      mocks.dashboardEventHandler?.({
        source: "todoist",
        reason: "sync_settled",
        state: "current",
      });
    });

    expect(mocks.handleDashboardEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: "todoist",
      reason: "sync_settled",
    }));
    expect(mocks.markCalendarDomainRangeStale).toHaveBeenCalledTimes(1);
    expect(mocks.getCalendarDeadlines).toHaveBeenCalledTimes(1);
  });

  it("clears the Bills pending snapshot once current-data refresh settles", () => {
    mocks.briefing = { weather: null, calendar: [], deadlines: { upcoming: [] }, emails: { accounts: [] } };
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
      mocks.latestShellProps!.loadCalendarBills({ force: true });
    });
    expect(mocks.latestShellProps!.calendarBillsData?.pendingUpdate).toBe(true);

    mocks.liveData = {
      ...mocks.liveData!,
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

    expect(mocks.latestShellProps!.calendarBillsData?.pendingUpdate).toBe(false);
  });
});
