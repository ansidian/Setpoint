import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../context/DashboardContext.jsx";
import { BrowserRouter } from "react-router-dom";

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

vi.mock("../components/shell/TriageAnalyticsModal", () => ({
  default: function TriageAnalyticsModalMock({ open, backdropSnapshot }) {
    return open ? (
      <div
        data-testid="triage-analytics-modal"
        data-backdrop-snapshot={backdropSnapshot?.dataUrl || ""}
      />
    ) : null;
  },
}));

vi.mock("@/components/shell/analyticsBackdropSnapshot.js", () => ({
  captureAnalyticsBackdropSnapshot: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,test-dashboard-backdrop",
  })),
  prewarmAnalyticsBackdropCapture: vi.fn(),
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

const { RedesignShell } = await import("./Dashboard.jsx");
const { captureAnalyticsBackdropSnapshot } = await import("@/components/shell/analyticsBackdropSnapshot.js");

afterEach(() => {
  window.localStorage.removeItem("calendar:lastView");
  window.localStorage.removeItem("ea:tab");
  latestInboxProps = null;
  cleanup();
  vi.clearAllMocks();
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
        <RedesignShell {...props} />
      </DashboardProvider>
    </BrowserRouter>,
  );
}

describe("RedesignShell mobile behavior", () => {
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

  it("keeps calendar available on desktop and opens it from the hotkey", async () => {
    mockIsMobile = false;
    renderShell();

    expect(screen.getByTestId("shell-header-desktop")).toBeTruthy();
    expect(screen.queryByTestId("calendar-modal")).toBeNull();
    expect(screen.queryByTestId("shell-header-briefing-status")).toBeNull();

    fireEvent.keyDown(window, { key: "c" });
    expect((await screen.findByTestId("calendar-modal")).textContent).toBe("open");
  });

  it("opens shell analytics from the A hotkey without stealing text input", async () => {
    mockIsMobile = false;
    renderShell();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "a" });
    expect(screen.queryByTestId("triage-analytics-modal")).toBeNull();
    input.remove();

    fireEvent.keyDown(window, { key: "A" });
    expect(await screen.findByTestId("triage-analytics-modal")).toBeTruthy();

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => {
      expect(screen.queryByTestId("triage-analytics-modal")).toBeNull();
    });
  });

  it("opens shell analytics without running backdrop capture on the click path", async () => {
    mockIsMobile = false;
    captureAnalyticsBackdropSnapshot.mockImplementationOnce(() => new Promise(() => {}));
    renderShell();

    fireEvent.keyDown(window, { key: "A" });

    expect(await screen.findByTestId("triage-analytics-modal")).toBeTruthy();
    expect(captureAnalyticsBackdropSnapshot).not.toHaveBeenCalled();
  });

  it("opens shell analytics from the command palette action", async () => {
    mockIsMobile = false;
    renderShell();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByTestId("command-palette-analytics-action"));

    expect(await screen.findByTestId("triage-analytics-modal")).toBeTruthy();
  });

  it("ignores a stale persisted Deadlines calendar view", async () => {
    mockIsMobile = false;
    window.localStorage.setItem("calendar:lastView", "deadlines");
    renderShell();

    fireEvent.keyDown(window, { key: "c" });

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

  it("keeps single-key calendar open and ignores chords while typing", async () => {
    mockIsMobile = false;
    renderShell();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "t" });
    expect(screen.queryByTestId("add-task-panel")).toBeNull();
    input.remove();

    fireEvent.keyDown(window, { key: "c" });
    expect((await screen.findByTestId("calendar-modal")).textContent).toBe("open");
  });

  it("uses Y for snapshots so H stays available to inbox handling", () => {
    mockIsMobile = false;
    const props = makeProps();
    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <RedesignShell {...props} />
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
          <RedesignShell {...props} />
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
          <RedesignShell {...refreshedProps} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(latestInboxProps.liveReadOverrides).toEqual({ "snapshot-read": true });
    });
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
    props.calendarDeadlines = {
      ctm: { upcoming: [] },
      todoist: { upcoming: props.bd.briefing.todoist.upcoming },
    };

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
	      expect(modal.getAttribute("data-view")).toBe("events");
	      expect(modal.getAttribute("data-focus-date")).toBe("2026-04-20");
	      expect(modal.getAttribute("data-focus-item-id")).toBe("todo-42");
	      expect(modal.getAttribute("data-focus-open-detail")).toBe("true");
	      expect(modal.getAttribute("data-force-deadline-overlay")).toBe("true");
	    });
  });

  it("routes desktop bill clicks into the calendar modal with focused item detail state", async () => {
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
          <RedesignShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getAllByText("Rent").at(-1));

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
      expect(modal.getAttribute("data-view")).toBe("bills");
      expect(modal.getAttribute("data-focus-date")).toBe("2026-04-20");
      expect(modal.getAttribute("data-focus-item-id")).toBe("bill-rent");
      expect(modal.getAttribute("data-focus-open-detail")).toBe("true");
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
