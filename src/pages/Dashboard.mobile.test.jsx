import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../context/DashboardContext.jsx";
import { BrowserRouter } from "react-router-dom";

let mockIsMobile = false;
let mockCustomize = null;

vi.mock("../hooks/useIsMobile", () => ({
  default: () => mockIsMobile,
}));

vi.mock("../hooks/useCustomize", () => ({
  default: () => mockCustomize,
}));

vi.mock("../components/calendar/CalendarModal", () => ({
  default: function CalendarModalMock({ open, focusDate = null, focusItemId = null }) {
    return (
      <div
        data-testid="calendar-modal"
        data-focus-date={focusDate || ""}
        data-focus-item-id={focusItemId || ""}
      >
        {open ? "open" : "closed"}
      </div>
    );
  },
}));

vi.mock("../components/briefing/BriefingHistoryPanel", () => ({
  default: function BriefingHistoryPanelMock() {
    return null;
  },
}));

vi.mock("../components/shell/CommandPalette", () => ({
  default: function CommandPaletteMock() {
    return null;
  },
}));

vi.mock("../components/shell/CustomizePanel", () => ({
  default: function CustomizePanelMock() {
    return null;
  },
}));

vi.mock("../components/inbox/InboxView", () => ({
  default: function InboxViewMock() {
    return <div data-testid="inbox-view" />;
  },
}));

vi.mock("../components/dashboard/DeadlineDetailPopover", () => ({
  default: function DeadlineDetailPopoverMock() {
    return null;
  },
}));

const { RedesignShell } = await import("./Dashboard.jsx");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockCustomize = {
    dashboardLayout: "command",
    density: "comfortable",
    showInsights: true,
    showInboxPeek: true,
    accent: "#cba6da",
  };
});

function makeBriefing() {
  return {
    aiInsights: [],
    aiGeneratedAt: "2026-04-19T15:00:00.000Z",
    dataUpdatedAt: "2026-04-19T15:04:00.000Z",
    skippedAI: false,
    nonAiGenerationCount: 0,
    emails: {
      summary: "Brief summary",
      accounts: [
        {
          important: [
            {
              id: "email-1",
              subject: "Subject",
              from: "Alex",
              date: "2026-04-19T15:30:00.000Z",
              read: false,
            },
          ],
          unread: 1,
        },
      ],
    },
    weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
    ctm: { upcoming: [] },
    todoist: { upcoming: [] },
  };
}

function makeProps() {
  return {
    bd: {
      briefing: makeBriefing(),
      schedules: [{ enabled: true, time: "09:00", label: "Morning Briefing" }],
      refreshing: false,
      generating: false,
      genProgress: null,
      viewingPast: null,
      latestId: "latest",
      lastQuickRefreshAt: null,
      handleQuickRefresh: vi.fn(),
      selectHistory: vi.fn(),
    },
    liveData: {
      actualConfigured: true,
      liveEmails: [],
      liveWeather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
      liveBills: [],
      allSchedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "",
      pinnedIds: [],
      pinnedSnapshots: {},
      snoozedEntries: [],
      resurfacedEntries: [],
      briefingGeneratedAt: null,
      refreshNow: vi.fn(),
    },
    calendarRange: {
      ensureRange: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn(),
      hasMonth: vi.fn(),
      isMonthLoading: vi.fn(),
      loading: false,
      error: null,
    },
    refreshHold: {
      holdProgress: 0,
      showConfirm: false,
      startHold: vi.fn(),
      endHold: vi.fn(),
      setShowConfirm: vi.fn(),
    },
    handleFullGeneration: vi.fn(),
    historyOpen: false,
    setHistoryOpen: vi.fn(),
    historyTriggerRef: { current: null },
    calendarDeadlines: null,
    loadCalendarDeadlines: vi.fn(),
  };
}

function renderShell() {
  const props = makeProps();
  return render(
    <BrowserRouter>
      <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <RedesignShell {...props} />
      </DashboardProvider>
    </BrowserRouter>,
  );
}

describe("RedesignShell mobile behavior", () => {
  it("keeps calendar available on desktop and opens it from the hotkey", () => {
    mockIsMobile = false;
    renderShell();

    expect(screen.getByTestId("shell-header-desktop")).toBeTruthy();
    expect(screen.getByTestId("calendar-modal").textContent).toBe("closed");
    expect(screen.getByTestId("shell-header-briefing-status").textContent).toContain("Claude");
    expect(screen.getByTestId("shell-header-briefing-status").textContent).toContain("Next 9:00 AM");
    expect(screen.getByTestId("shell-header-briefing-status").getAttribute("title")).toContain("Morning Briefing");
    expect(screen.getByTestId("shell-header-briefing-status").getAttribute("title")).toContain("Claude refreshed");

    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByTestId("calendar-modal").textContent).toBe("open");
  });

  it("describes clone-path briefings in the shell status surface", () => {
    mockIsMobile = false;
    const props = makeProps();
    props.bd.briefing = {
      ...makeBriefing(),
      skippedAI: true,
      nonAiGenerationCount: 2,
    };

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    expect(screen.getByTestId("shell-header-briefing-status").textContent).toContain("Quiet x2");
    expect(screen.getByTestId("shell-header-briefing-status").textContent).not.toContain("Updated");
    expect(screen.getByTestId("shell-header-briefing-status").textContent).toContain("Next 9:00 AM");
    expect(screen.getByTestId("shell-header-briefing-status").getAttribute("title")).toContain("Morning Briefing");
  });

  it("keeps the AI headline visible when a refresh notice becomes active", async () => {
    mockIsMobile = false;
    const props = makeProps();
    const view = render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    view.rerender(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell
            {...props}
            bd={{
              ...props.bd,
              latestId: "latest-2",
              lastQuickRefreshAt: Date.now(),
            }}
          />
        </DashboardProvider>
      </BrowserRouter>,
    );

    await waitFor(() => {
      const text = screen.getByTestId("shell-header-briefing-status").textContent;
      expect(text).toContain("Claude");
      expect(text).toContain("Updated");
      expect(text).not.toContain("Briefing updated just now");
      expect(screen.getByTestId("shell-header-briefing-status").getAttribute("title")).toContain("Claude refreshed");
    });
  });

  it("compacts just-now update copy in the shell status pill", () => {
    mockIsMobile = false;
    const props = makeProps();
    props.bd.briefing = {
      ...makeBriefing(),
      dataUpdatedAt: new Date().toISOString(),
      skippedAI: true,
      nonAiGenerationCount: 1,
    };

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    const status = screen.getByTestId("shell-header-briefing-status");
    expect(status.textContent).toContain("Updated");
    expect(status.textContent).not.toContain("Updated just now");
    expect(status.getAttribute("title")).toContain("Updated just now");
  });

  it("drops the update badge after one minute", () => {
    mockIsMobile = false;
    const props = makeProps();
    props.bd.briefing = {
      ...makeBriefing(),
      dataUpdatedAt: new Date(Date.now() - 61_000).toISOString(),
      skippedAI: true,
      nonAiGenerationCount: 1,
    };

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    expect(screen.getByTestId("shell-header-briefing-status").textContent).not.toContain("Updated");
  });

  it("routes desktop deadline clicks into the calendar modal with focused item state", async () => {
    mockIsMobile = false;
    const props = makeProps();
    props.bd.briefing.todoist.upcoming = [
      {
        id: "todo-42",
        title: "Ship report",
        due_date: "2026-04-20",
        due_time: "9:00 AM",
        source: "todoist",
        class_name: "Inbox",
        status: "open",
      },
    ];

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getAllByText("Ship report")[0]);

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
      expect(modal.getAttribute("data-focus-date")).toBe("2026-04-20");
      expect(modal.getAttribute("data-focus-item-id")).toBe("todo-42");
    });
  });

  it("uses browser back to close the desktop calendar modal", async () => {
    mockIsMobile = false;
    renderShell();

    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByTestId("calendar-modal").textContent).toBe("open");

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-modal").textContent).toBe("closed");
    });
  });
});
