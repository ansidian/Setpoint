import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";

const mocks = vi.hoisted(() => ({
  autoRefreshArgs: null,
  holdGestureArgs: null,
  invalidateCalendarRange: vi.fn(),
  markCalendarRangeStale: vi.fn(),
  refreshCalendarRangeInPlace: vi.fn(),
  handleQuickRefresh: vi.fn(),
  handleFullGeneration: vi.fn(),
  getCalendarDeadlines: vi.fn(),
}));

vi.mock("../api", () => ({
  getCalendarDeadlines: mocks.getCalendarDeadlines,
  deleteBriefing: vi.fn(),
}));

vi.mock("../hooks/useLiveData", () => ({
  default: () => ({
    allSchedules: [],
    recentTransactions: [],
    payeeMap: {},
    actualBudgetUrl: "",
    refreshNow: vi.fn(),
  }),
}));

vi.mock("../hooks/useCalendarRange", () => ({
  default: () => ({
    invalidate: mocks.invalidateCalendarRange,
    markStale: mocks.markCalendarRangeStale,
    refreshRangeInPlace: mocks.refreshCalendarRangeInPlace,
  }),
}));

vi.mock("../hooks/useBriefingData", () => ({
  default: () => ({
    loading: false,
    error: null,
    briefing: null,
    generating: false,
    genProgress: null,
    lastQuickRefreshAt: null,
    handleQuickRefresh: mocks.handleQuickRefresh,
    handleFullGeneration: mocks.handleFullGeneration,
  }),
}));

vi.mock("../hooks/useAutoRefresh", () => ({
  default: (args) => {
    mocks.autoRefreshArgs = args;
  },
}));

vi.mock("../hooks/useHoldGesture", () => ({
  default: (args) => {
    mocks.holdGestureArgs = args;
    return {
      showConfirm: false,
      setShowConfirm: vi.fn(),
      startHold: vi.fn(),
      endHold: vi.fn(),
      holdTimerRef: { current: null },
    };
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
    mocks.autoRefreshArgs = null;
    mocks.holdGestureArgs = null;
    mocks.invalidateCalendarRange.mockReset();
    mocks.markCalendarRangeStale.mockReset();
    mocks.refreshCalendarRangeInPlace.mockReset();
    mocks.handleQuickRefresh.mockReset();
    mocks.handleFullGeneration.mockReset();
    mocks.getCalendarDeadlines.mockReset();
    mocks.getCalendarDeadlines.mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps timer refresh from invalidating calendar range while explicit refresh does", () => {
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    mocks.autoRefreshArgs.onQuickRefresh();

    expect(mocks.handleQuickRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).not.toHaveBeenCalled();
    expect(mocks.getCalendarDeadlines).not.toHaveBeenCalled();

    mocks.holdGestureArgs.onShortPress();

    expect(mocks.invalidateCalendarRange).not.toHaveBeenCalled();
    expect(mocks.markCalendarRangeStale).toHaveBeenCalledTimes(1);
    expect(mocks.refreshCalendarRangeInPlace).not.toHaveBeenCalled();
    expect(mocks.handleQuickRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.getCalendarDeadlines).toHaveBeenCalledTimes(1);
  });
});
