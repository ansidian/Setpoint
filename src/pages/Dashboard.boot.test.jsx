import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";
import { resolveDashboardBriefingState } from "./Dashboard.bootState.js";

const mocks = vi.hoisted(() => ({
  getCalendarDeadlines: vi.fn(),
  activeSnapshot: {
    snapshot: { id: 10 },
    lanes: {
      needs_attention: [{
        id: 42,
        uid: "gmail-a-msg-1",
        email_id: "gmail-a-msg-1",
        account_id: "gmail-a",
        subject: "Review contract",
      }],
      fyi: [],
      noise: [],
    },
    carryover: [],
    filters: { accounts: [], categories: [] },
  },
}));

vi.mock("../api", () => ({
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

vi.mock("../hooks/useCurrentDashboard", () => ({
  default: () => ({
    liveData: {
      liveEmails: [],
      liveWeather: null,
      liveCalendar: null,
      liveBills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: false,
      actualBudgetUrl: null,
      refreshNow: vi.fn(),
    },
    activeSnapshot: {
      snapshot: mocks.activeSnapshot,
      loading: false,
      error: null,
      refresh: vi.fn(),
      sync: vi.fn(),
    },
    briefingData: {
      loading: false,
      error: null,
      briefing: null,
      setBriefing: vi.fn(),
      refreshing: false,
      latestId: null,
      schedules: [],
      lastQuickRefreshAt: null,
      handleQuickRefresh: vi.fn(),
    },
  }),
}));

vi.mock("../hooks/useAutoRefresh", () => ({ default: () => {} }));
vi.mock("../hooks/useNotifications", () => ({ default: () => {} }));

vi.mock("../components/dashboard/RedesignShell", () => ({
  RedesignShell: ({ bd, activeSnapshot }) => (
    <div data-testid="dashboard-shell">
      {bd.briefing?.emails?.accounts?.length ?? 0}
      {activeSnapshot?.snapshot ? " active-snapshot" : ""}
    </div>
  ),
  DashboardBody: () => null,
}));

describe("Dashboard boot", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    mocks.getCalendarDeadlines.mockReset();
    mocks.getCalendarDeadlines.mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts the active dashboard when snapshot data exists without a current legacy briefing", () => {
    const bootState = resolveDashboardBriefingState({
      loading: false,
      error: null,
      briefing: null,
      activeSnapshot: mocks.activeSnapshot,
    });

    expect(bootState.view).toBe("dashboard");
    expect(bootState.effectiveBriefing).toBeNull();

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    expect(screen.getByTestId("dashboard-shell").textContent).toContain("active-snapshot");
    expect(screen.queryByText(/no briefings yet/i)).toBeNull();
    expect(mocks.getCalendarDeadlines).not.toHaveBeenCalled();
  });
});
