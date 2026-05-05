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
  handleFullGeneration: vi.fn(),
  activeSnapshotRefresh: vi.fn(),
  activeSnapshotSync: vi.fn(),
  getCalendarDeadlines: vi.fn(),
  getCalendarDeadlinesRange: vi.fn(),
  getCalendarBillsRange: vi.fn(),
}));

vi.mock("../api", () => ({
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  getCalendarDeadlinesRange: mocks.getCalendarDeadlinesRange,
  getCalendarBillsRange: mocks.getCalendarBillsRange,
  deleteBriefing: vi.fn(),
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
  default: () => ({
    liveData: {
      allSchedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "",
      actualConfigured: false,
      refreshNow: mocks.currentRefreshNow,
    },
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
      briefing: null,
      generating: false,
      genProgress: null,
      lastQuickRefreshAt: null,
      handleQuickRefresh: mocks.handleQuickRefresh,
      handleFullGeneration: mocks.handleFullGeneration,
    },
  }),
}));

vi.mock("../hooks/useAutoRefresh", () => ({
  default: (args) => {
    mocks.autoRefreshArgs = args;
  },
}));

vi.mock("../hooks/useNotifications", () => ({
  default: () => {},
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
    mocks.handleFullGeneration.mockReset();
    mocks.activeSnapshotRefresh.mockReset();
    mocks.activeSnapshotSync.mockReset();
    mocks.getCalendarDeadlines.mockReset();
    mocks.getCalendarDeadlines.mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps timer refresh from invalidating calendar range while explicit refresh does", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    mocks.autoRefreshArgs.onQuickRefresh();

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

  it("maps the R hotkey to Sync now without invoking briefing generation", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    fireEvent.keyDown(window, { key: "r" });

    expect(mocks.handleQuickRefresh).not.toHaveBeenCalled();
    expect(mocks.activeSnapshotSync).toHaveBeenCalledTimes(1);
    expect(mocks.handleFullGeneration).not.toHaveBeenCalled();
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
});
