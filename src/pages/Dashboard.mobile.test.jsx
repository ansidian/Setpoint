import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../context/DashboardContext.jsx";
import { BrowserRouter } from "react-router-dom";
import { resetInboxSession } from "../components/inbox/useInboxSessionState.js";

let mockIsMobile = false;
let mockCustomize = null;
let latestInboxProps = null;

vi.mock("../hooks/useIsMobile", () => ({
  default: () => mockIsMobile,
}));

vi.mock("../hooks/useCustomize", () => ({
  default: () => mockCustomize,
}));

vi.mock("../components/calendar/CalendarModal", () => ({
  default: function CalendarModalMock({
    open,
    view = "",
	    focusDate = null,
	    focusItemId = null,
	    focusOpenDetail = false,
	    forceDeadlineOverlay = false,
	  }) {
    return (
      <div
        data-testid="calendar-modal"
        data-view={view}
        data-focus-date={focusDate || ""}
	        data-focus-item-id={focusItemId || ""}
	        data-focus-open-detail={focusOpenDetail ? "true" : "false"}
	        data-force-deadline-overlay={forceDeadlineOverlay ? "true" : "false"}
	      >
        {open ? "open" : "closed"}
      </div>
    );
  },
}));

vi.mock("../components/todoist/AddTaskPanel", () => ({
  default: function AddTaskPanelMock() {
    return <div data-testid="add-task-panel" />;
  },
}));

vi.mock("../components/briefing/BriefingHistoryPanel", () => ({
  default: function BriefingHistoryPanelMock() {
    return null;
  },
}));

vi.mock("../components/shell/CommandPalette", () => ({
  default: function CommandPaletteMock({ open, onAction }) {
    return open ? (
      <button
        type="button"
        data-testid="command-palette-analytics-action"
        onClick={() => onAction({ kind: "analytics" })}
      >
        Analytics action
      </button>
    ) : null;
  },
}));

// Mock the loader (a static named import) rather than the modal module — vi.mock
// does not reliably intercept the lazy `import("./AiAnalyticsModal")` that lives
// inside the loader, so mocking the loader is what makes the lazy surface
// deterministic here.
vi.mock("../components/shell/aiAnalyticsModalLoader.js", () => ({
  loadAiAnalyticsModal: () => Promise.resolve({
    default: function AiAnalyticsModalMock({ open }) {
      return open ? <div data-testid="ai-analytics-modal" /> : null;
    },
  }),
}));

vi.mock("../components/shell/CustomizePanel", () => ({
  default: function CustomizePanelMock() {
    return null;
  },
}));

vi.mock("../components/inbox/InboxView", () => ({
  default: function InboxViewMock(props) {
    latestInboxProps = props;
    return <div data-testid="inbox-view" />;
  },
}));

vi.mock("../components/dashboard/DeadlineDetailPopover", () => ({
  default: function DeadlineDetailPopoverMock() {
    return null;
  },
}));

const { DashboardShell } = await import("./Dashboard.jsx");

afterEach(() => {
  window.localStorage.removeItem("calendar:lastView");
  window.localStorage.removeItem("ea:tab");
  latestInboxProps = null;
  cleanup();
  vi.clearAllMocks();
  resetInboxSession();
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
    deadlines: { upcoming: [], stats: null },
  };
}

function makeProps() {
  return {
    bd: {
      briefing: makeBriefing(),
      schedules: [{ enabled: true, time: "09:00", label: "Morning Briefing" }],
      refreshing: false,
      latestId: "latest",
      lastQuickRefreshAt: null,
      handleQuickRefresh: vi.fn(),
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
    historyOpen: false,
    setHistoryOpen: vi.fn(),
    historyTriggerRef: { current: null },
    calendarDeadlines: null,
    loadCalendarDeadlines: vi.fn(),
    loadCalendarBills: vi.fn(),
  };
}

function renderShell() {
  const props = makeProps();
  return render(
    <BrowserRouter>
      <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <DashboardShell {...props} />
      </DashboardProvider>
    </BrowserRouter>,
  );
}

describe("DashboardShell mobile behavior", () => {
  it("uses the mobile task surface for task creation chords without mounting the desktop calendar", async () => {
    mockIsMobile = true;
    renderShell();

    fireEvent.keyDown(window, { key: "c" });
    expect(screen.queryByTestId("calendar-modal")).toBeNull();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "t" });

    expect(await screen.findByTestId("add-task-panel")).toBeTruthy();
    expect(screen.queryByTestId("calendar-modal")).toBeNull();
  });

  it("keeps calendar available on desktop and opens it from the tab hotkey", async () => {
    mockIsMobile = false;
    renderShell();

    expect(screen.getByTestId("shell-header-desktop")).toBeTruthy();
    expect(screen.queryByTestId("calendar-modal")).toBeNull();
    expect(screen.queryByTestId("shell-header-briefing-status")).toBeNull();

    // The calendar is the third shell tab; the `3` hotkey activates it, which
    // mounts the (mocked) calendar surface.
    fireEvent.keyDown(window, { key: "3" });
    expect((await screen.findByTestId("calendar-modal")).textContent).toBe("open");
  });

  it("opens shell analytics from the A hotkey without stealing text input", async () => {
    mockIsMobile = false;
    renderShell();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "a" });
    expect(screen.queryByTestId("ai-analytics-modal")).toBeNull();
    input.remove();

    fireEvent.keyDown(window, { key: "A" });
    expect(await screen.findByTestId("ai-analytics-modal")).toBeTruthy();

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => {
      expect(screen.queryByTestId("ai-analytics-modal")).toBeNull();
    });
  });

  it("opens shell analytics immediately with no backdrop rasterization on the open path", async () => {
    mockIsMobile = false;
    renderShell();

    fireEvent.keyDown(window, { key: "A" });

    // The backdrop is now a static CSS faux-frost in the overlay style — opening
    // analytics is a pure state flip with no html-to-image capture to wait on.
    expect(await screen.findByTestId("ai-analytics-modal")).toBeTruthy();
  });

  it("opens shell analytics from the command palette action", async () => {
    mockIsMobile = false;
    renderShell();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByTestId("command-palette-analytics-action"));

    expect(await screen.findByTestId("ai-analytics-modal")).toBeTruthy();
  });

  it("ignores a stale persisted calendar view", async () => {
    mockIsMobile = false;
    window.localStorage.setItem("calendar:lastView", "legacy");
    renderShell();

    fireEvent.keyDown(window, { key: "3" });

    const modal = await screen.findByTestId("calendar-modal");
    expect(modal.textContent).toBe("open");
    expect(modal.getAttribute("data-view")).toBe("events");
  });

  it("opens create surfaces from dashboard action chords", async () => {
    mockIsMobile = false;
    renderShell();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "t" });
    expect(screen.queryByTestId("add-task-panel")).toBeNull();
    const taskCalendar = await screen.findByTestId("calendar-modal");
    expect(taskCalendar.textContent).toBe("open");
    expect(taskCalendar.getAttribute("data-view")).toBe("events");
    expect(taskCalendar.getAttribute("data-focus-item-id")).toBe("new");
    expect(taskCalendar.getAttribute("data-force-deadline-overlay")).toBe("true");

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    await waitFor(() => {
      const eventCalendar = screen.getByTestId("calendar-modal");
      expect(eventCalendar.textContent).toBe("open");
      expect(eventCalendar.getAttribute("data-view")).toBe("events");
      expect(eventCalendar.getAttribute("data-focus-item-id")).toBe("new");
    });
  });

  it("switches to the calendar tab with 3 and ignores chords while typing", async () => {
    mockIsMobile = false;
    renderShell();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "t" });
    expect(screen.queryByTestId("add-task-panel")).toBeNull();
    input.remove();

    fireEvent.keyDown(window, { key: "3" });
    expect((await screen.findByTestId("calendar-modal")).textContent).toBe("open");
  });

  it("uses Y for snapshots so H stays available to inbox handling", () => {
    mockIsMobile = false;
    const props = makeProps();
    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    fireEvent.keyDown(window, { key: "h" });
    expect(props.setHistoryOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "y" });
    expect(props.setHistoryOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps active snapshot read overrides across dashboard refreshes", async () => {
    mockIsMobile = false;
    window.localStorage.setItem("ea:tab", "inbox");
    const props = makeProps();
    props.activeSnapshot = {
      snapshot: {
        snapshot: { id: 77, updated_at: "2026-05-07T15:00:00.000Z" },
        filters: { accounts: [], categories: [] },
        carryover: [],
        lanes: {
          needs_attention: [{
            id: 42,
            snapshot_item_id: 42,
            uid: "snapshot-read",
            email_id: "snapshot-read",
            account_id: "gmail-a",
            lane: "needs_attention",
            subject: "Read in session",
            read: false,
          }],
          fyi: [],
          handled: [],
          noise: [],
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      sync: vi.fn(),
    };

    const { rerender } = render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    await screen.findByTestId("inbox-view");
    act(() => {
      latestInboxProps.onLiveReadOverrideChange("snapshot-read", true);
    });
    await waitFor(() => {
      expect(latestInboxProps.liveReadOverrides).toEqual({ "snapshot-read": true });
    });

    const refreshedProps = {
      ...props,
      liveData: {
        ...props.liveData,
        liveEmails: [],
        resurfacedEntries: [],
      },
    };
    rerender(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...refreshedProps} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(latestInboxProps.liveReadOverrides).toEqual({ "snapshot-read": true });
    });
  });

  it("opens the desktop calendar from deadline clicks and loads deadline data", async () => {
    mockIsMobile = false;
    const props = makeProps();
    props.bd.briefing.deadlines.upcoming = [
      {
        id: "todo-42",
        title: "Ship report",
        due_date: "2026-04-20",
        due_time: "9:00 AM",
        class_name: "Inbox",
        status: "open",
      },
    ];
    props.calendarDeadlines = {
      upcoming: props.bd.briefing.deadlines.upcoming,
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
    };

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getAllByText("Ship report")[0]);

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
    });
    expect(props.loadCalendarDeadlines).toHaveBeenCalledTimes(1);
  });

  it("opens the desktop calendar from bill clicks and refreshes bill data", async () => {
    mockIsMobile = false;
    const props = makeProps();
    props.liveData.liveBills = [
      {
        id: "bill-rent",
        name: "Rent",
        payee: "Landlord",
        amount: 1800,
        next_date: "2026-04-20",
        paid: false,
      },
    ];

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getAllByText("Rent").at(-1));

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
    });
    expect(props.loadCalendarBills).toHaveBeenCalledWith({ refreshLive: true });
  });

  it("exposes the Calendar shell tab on desktop only", () => {
    mockIsMobile = true;
    const { unmount } = renderShell();

    // Mobile drops the Calendar tab from the shell tablist.
    expect(screen.queryByRole("button", { name: /calendar/i })).toBeNull();

    unmount();
    cleanup();

    mockIsMobile = false;
    renderShell();

    // Desktop renders the third Calendar tab button alongside Dashboard and Inbox.
    expect(screen.getByRole("button", { name: /calendar/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /inbox/i })).toBeTruthy();
  });
});
