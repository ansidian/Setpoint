import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../context/DashboardContext";
import { BrowserRouter } from "react-router-dom";
import { resetInboxSession } from "../components/inbox/useInboxSessionState";
import type { DashboardShellProps } from "../components/dashboard/DashboardShell";

interface InboxMockProps {
  onLiveReadOverrideChange: (uid: string, read: boolean) => void;
  liveReadOverrides: Record<string, boolean>;
}
interface CalendarModalMockProps {
  open: boolean;
  view?: string;
  focusDate?: string | null;
  focusItemId?: string | number | null;
  focusOpenDetail?: boolean;
  forceDeadlineOverlay?: boolean;
}
type MobileShellProps = DashboardShellProps & {
  bd: DashboardShellProps["bd"] & { briefing: NonNullable<DashboardShellProps["bd"]["briefing"]> };
};

let mockIsMobile = false;
let latestInboxProps: InboxMockProps | null = null;

vi.mock("../hooks/useIsMobile", () => ({
  default: () => mockIsMobile,
}));

vi.mock("../hooks/useUtilityPayLinks", () => ({
  useUtilityPayLinks: () => ({}),
}));

vi.mock("../components/calendar/CalendarModal", () => ({
  default: function CalendarModalMock({
    open,
    view = "",
	    focusDate = null,
	    focusItemId = null,
	    focusOpenDetail = false,
	    forceDeadlineOverlay = false,
  }: CalendarModalMockProps) {
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
  default: function CommandPaletteMock({ open, onAction }: { open: boolean; onAction: (action: { kind: string }) => void }) {
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
vi.mock("../components/shell/aiAnalyticsModalLoader", () => ({
  loadAiAnalyticsModal: () => Promise.resolve({
    default: function AiAnalyticsModalMock({ open }: { open: boolean }) {
      return open ? <div data-testid="ai-analytics-modal" /> : null;
    },
  }),
}));

vi.mock("../components/inbox/InboxView", () => ({
  default: function InboxViewMock(props: InboxMockProps) {
    latestInboxProps = props;
    return <div data-testid="inbox-view" />;
  },
}));

const { DashboardShell } = await import("./Dashboard");

afterEach(() => {
  window.localStorage.removeItem("calendar:lastView");
  window.localStorage.removeItem("ea:tab");
  latestInboxProps = null;
  cleanup();
  vi.clearAllMocks();
  resetInboxSession();
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

function makeProps(): MobileShellProps {
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
  } as unknown as MobileShellProps;
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

  it("opens shell analytics from the A hotkey", async () => {
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
    } as unknown as NonNullable<DashboardShellProps["activeSnapshot"]>;

    const { rerender } = render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    await screen.findByTestId("inbox-view");
    act(() => {
      latestInboxProps!.onLiveReadOverrideChange("snapshot-read", true);
    });
    await waitFor(() => {
      expect(latestInboxProps!.liveReadOverrides).toEqual({ "snapshot-read": true });
    });

    const refreshedProps: MobileShellProps = {
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
      expect(latestInboxProps!.liveReadOverrides).toEqual({ "snapshot-read": true });
    });
  });

  it("opens the calendar from a deadline glance sheet's Open in calendar and loads deadline data", async () => {
    // Pin the clock to the fixture day so the deadline classifies as due-today and
    // lands in the Needs-you band (the only home for overdue/due-today items now
    // that the rails are retired). shouldAdvanceTime keeps waitFor's poll alive.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-20T12:00:00-07:00"));
    mockIsMobile = false;
    const props = makeProps();
    const upcoming = [
      {
        id: "todo-42",
        title: "Ship report",
        due_date: "2026-04-20",
        due_time: "9:00 AM",
        class_name: "Inbox",
        status: "open",
      },
    ] as NonNullable<DashboardShellProps["calendarDeadlines"]>["upcoming"];
    props.bd.briefing = {
      ...props.bd.briefing,
      deadlines: {
        upcoming,
        stats: { incomplete: 1, dueToday: 1, dueThisWeek: 1, totalPoints: 0 },
      } as unknown as typeof props.bd.briefing.deadlines,
    };
    props.calendarDeadlines = {
      upcoming,
      stats: { incomplete: 1, dueToday: 1, dueThisWeek: 1, totalPoints: 0 },
    };

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    const band = screen.getByTestId("needs-you-band");
    // A dashboard tap opens the in-place glance sheet, not the calendar.
    fireEvent.click(within(band).getByText("Ship report"));
    expect(screen.queryByTestId("calendar-modal")).toBeNull();

    // "Open in calendar" is the explicit deep-link out — that is what loads data.
    fireEvent.click(await screen.findByRole("button", { name: /open in calendar/i }));

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
    });
    expect(props.loadCalendarDeadlines).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("opens the calendar from a bill glance sheet's Open in calendar and refreshes bill data", async () => {
    // Pin the clock so the bill is due-today (classifyBill admits only days===0),
    // putting "Rent" in the band as a clickable priority card.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-20T12:00:00-07:00"));
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

    const band = screen.getByTestId("needs-you-band");
    fireEvent.click(within(band).getByText("Rent"));
    expect(screen.queryByTestId("calendar-modal")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /open in calendar/i }));

    await waitFor(() => {
      const modal = screen.getByTestId("calendar-modal");
      expect(modal.textContent).toBe("open");
    });
    expect(props.loadCalendarBills).toHaveBeenCalledWith({ refreshLive: true });
    vi.useRealTimers();
  });

  it("opens a bill in an in-place sheet (not the calendar tab) on mobile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-20T12:00:00-07:00"));
    mockIsMobile = true;
    const props = makeProps();
    props.liveData.liveBills = [
      { id: "bill-rent", name: "Rent", payee: "Landlord", amount: 1800, next_date: "2026-04-20", paid: false },
    ];

    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    const band = screen.getByTestId("needs-you-band");
    fireEvent.click(within(band).getByText("Rent"));

    // The in-place detail sheet exposes "Open in calendar"; the calendar tab is
    // never mounted (no tab switch) on a mobile dashboard tap.
    await screen.findByRole("button", { name: /open in calendar/i });
    expect(screen.queryByTestId("calendar-modal")).toBeNull();
    vi.useRealTimers();
  });

  it("restores the mobile dashboard scroll offset after a tab round-trip", async () => {
    mockIsMobile = true;
    const props = makeProps();
    render(
      <BrowserRouter>
        <DashboardProvider briefing={props.bd.briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
          <DashboardShell {...props} />
        </DashboardProvider>
      </BrowserRouter>,
    );

    const scroller = screen.getByTestId("shell-scroll-region");
    // Record an offset live while the dashboard tab is active.
    scroller.scrollTop = 420;
    fireEvent.scroll(scroller);

    // Leave to the (mocked) calendar tab; emulate the browser clamping the shared
    // container while the dashboard is hidden behind a shorter tab.
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    await waitFor(() => expect(screen.getByTestId("calendar-modal")).toBeTruthy());
    scroller.scrollTop = 0;

    // Returning to the dashboard restores the saved offset.
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() => expect(scroller.scrollTop).toBe(420));
  });

});
