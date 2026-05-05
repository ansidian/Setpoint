import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";

const mocks = vi.hoisted(() => ({
  activeSnapshotSync: vi.fn(),
  liveRefreshNow: vi.fn(),
}));

vi.mock("../api", () => ({
  getCalendarDeadlines: vi.fn().mockResolvedValue({ ctm: { upcoming: [] }, todoist: { upcoming: [] } }),
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
      allSchedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "",
      actualConfigured: false,
      refreshNow: mocks.liveRefreshNow,
    },
    activeSnapshot: {
      snapshot: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      sync: mocks.activeSnapshotSync,
    },
    briefingData: {
      loading: false,
      error: null,
      briefing: {
        emails: { summary: "", accounts: [] },
        ctm: { upcoming: [], stats: null },
        todoist: { upcoming: [], stats: null },
        calendar: [],
      },
      setBriefing: vi.fn(),
      refreshing: false,
      handleQuickRefresh: vi.fn(),
    },
  }),
}));

vi.mock("../hooks/useAutoRefresh", () => ({ default: () => {} }));
vi.mock("../hooks/useNotifications", () => ({ default: () => {} }));
vi.mock("../components/dashboard/RedesignShell", () => ({
  RedesignShell: ({ bd, onQuickRefresh }) => (
    <div>
      <div data-testid="sync-state">{bd.refreshing ? "syncing" : "idle"}</div>
      <button type="button" onClick={onQuickRefresh}>Sync now</button>
    </div>
  ),
  DashboardBody: () => null,
}));

describe("Dashboard sync animation state", () => {
  beforeEach(() => {
    mocks.liveRefreshNow.mockReset().mockResolvedValue({});
    mocks.activeSnapshotSync.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("marks the shell as refreshing while current Sync now is in flight", async () => {
    let resolveSync;
    mocks.activeSnapshotSync.mockImplementation(() => new Promise((resolve) => {
      resolveSync = resolve;
    }));

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    expect(screen.getByTestId("sync-state").textContent).toBe("idle");

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sync-state").textContent).toBe("syncing");
    });

    resolveSync({});

    await waitFor(() => {
      expect(screen.getByTestId("sync-state").textContent).toBe("idle");
    });
  });

  it("clears the shell refreshing state if Sync now never settles", async () => {
    vi.useFakeTimers();
    mocks.activeSnapshotSync.mockImplementation(() => new Promise(() => {}));
    mocks.liveRefreshNow.mockResolvedValue({});

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    });

    expect(screen.getByTestId("sync-state").textContent).toBe("syncing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(screen.getByTestId("sync-state").textContent).toBe("idle");
  });
});
