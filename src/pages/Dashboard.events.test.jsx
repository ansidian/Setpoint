import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBody } from "./Dashboard.jsx";
import { DashboardProvider } from "../context/DashboardContext.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeEvent(now, title) {
  return {
    id: title,
    title,
    startMs: now + 60 * 60000,
    endMs: now + 120 * 60000,
    allDay: false,
    color: "#4285f4",
    location: "Room 1",
  };
}

function makeBriefing(events = []) {
  return {
    weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
    calendar: events,
    deadlines: {
      upcoming: [{ id: "deadline-1", title: "Essay", due_date: "2026-04-20", status: "open" }],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
    },
    emails: { summary: "", accounts: [] },
  };
}

function renderDashboardBody({
  briefing,
  ensureRange,
  onOpenBillsCalendar = () => {},
  onOpenDeadline = () => {},
  onOpenDeadlinesCalendar = () => {},
  onOpenEventsCalendar = () => {},
  liveData: liveDataOverrides = {},
  calendarDeadlines = undefined,
  calendarDeadlinesLoading = false,
  calendarDeadlinesError = false,
}) {
  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
        briefing={briefing}
        liveData={{
        liveBills: [],
        liveWeather: briefing.weather,
        liveCalendar: briefing.calendar,
        liveDeadlines: briefing.deadlines,
        liveEmails: [],
          billsLoading: false,
          actualConfigured: false,
          isPolling: false,
          ...liveDataOverrides,
        }}
        calendarRange={{
          ensureRange,
          getEvents: vi.fn(),
          hasMonth: vi.fn(),
          isMonthLoading: vi.fn(),
          loading: false,
          error: null,
          revision: 0,
        }}
        customize={{
          dashboardLayout: "focus",
          density: "comfortable",
          showInsights: true,
          showInboxPeek: false,
        }}
        accent="#cba6da"
        isMobile={false}
        calendarDeadlines={calendarDeadlines}
        calendarDeadlinesLoading={calendarDeadlinesLoading}
        calendarDeadlinesError={calendarDeadlinesError}
        onOpenEmail={() => {}}
        onOpenDeadline={onOpenDeadline}
        onOpenBillsCalendar={onOpenBillsCalendar}
        onOpenEventsCalendar={onOpenEventsCalendar}
        onOpenDeadlinesCalendar={onOpenDeadlinesCalendar}
        onJumpSection={() => {}}
      />
    </DashboardProvider>,
  );
}

describe("Dashboard event loading", () => {
  it("holds the dashboard timeline while seeded events are refreshing", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const event = makeEvent(now, "Seeded focus block");
    renderDashboardBody({
      briefing: makeBriefing([event]),
      ensureRange: vi.fn(() => new Promise(() => {})),
    });

    expect(screen.getAllByText("Seeded focus block").length).toBe(1);
    expect(within(screen.getByTestId("today-timeline")).queryByText("Seeded focus block")).toBeNull();
    expect(screen.getByTestId("dashboard-event-skeletons")).toBeTruthy();
    expect(screen.getByTestId("focus-window-refresh-status")).toBeTruthy();
    expect(screen.getByTestId("timeline-refresh-status")).toBeTruthy();
    expect(screen.getAllByText("Updating Google Calendar").length).toBe(2);
  });

  it("holds the dashboard timeline skeleton instead of showing a deadline-only timeline while events are cold", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn(() => new Promise(() => {})),
    });

    expect(screen.getByTestId("dashboard-event-skeletons")).toBeTruthy();
    expect(screen.getByTestId("focus-window-skeleton")).toBeTruthy();
    expect(screen.getAllByText("Essay").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("today-timeline")).queryByText("Essay")).toBeNull();
    expect(screen.queryByTestId("focus-window-refresh-status")).toBeNull();
    expect(screen.queryByTestId("timeline-refresh-status")).toBeNull();
  });

  it("shows a local bills placeholder while Actual data is still loading", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn().mockResolvedValue([]),
      liveData: {
        liveBills: [],
        billsLoading: true,
        actualConfigured: true,
        isPolling: true,
      },
    });

    expect(screen.getByTestId("bills-rail-loading-placeholder")).toBeTruthy();
    expect(screen.getByTestId("bills-rail-refresh-status")).toBeTruthy();
    expect(screen.queryByText("No upcoming bills")).toBeNull();
  });

  it("keeps the bills placeholder during initial Actual loading before polling flips on", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn().mockResolvedValue([]),
      liveData: {
        liveBills: [],
        billsLoading: true,
        actualConfigured: true,
        isPolling: false,
      },
    });

    expect(screen.getByTestId("bills-rail-loading-placeholder")).toBeTruthy();
    expect(screen.queryByText("No upcoming bills")).toBeNull();
  });

  it("activates the nearest pressure deadline row", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const onOpenDeadlinesCalendar = vi.fn();
    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn().mockResolvedValue([]),
      onOpenDeadlinesCalendar,
    });

    fireEvent.click(screen.getByRole("button", { name: /deadline soon/i }));
    expect(onOpenDeadlinesCalendar).toHaveBeenCalledWith("2026-04-20", "deadline-1");
  });

  it("holds stored briefing deadlines while live calendar deadlines are still loading", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderDashboardBody({
      briefing: {
        ...makeBriefing([]),
        deadlines: {
          upcoming: [{
            id: "deadline-rec",
            title: "Stale recurring review",
            due_date: "2026-04-21",
            status: "open",
            is_recurring: true,
          }],
          stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
        },
      },
      ensureRange: vi.fn().mockResolvedValue([]),
      calendarDeadlines: null,
      calendarDeadlinesLoading: true,
    });

    expect(screen.getByTestId("deadlines-rail-loading-placeholder")).toBeTruthy();
    expect(screen.queryByText("Stale recurring review")).toBeNull();
    expect(screen.queryByRole("button", { name: /deadline soon/i })).toBeNull();
  });

  it("uses live calendar deadlines over stale briefing deadlines", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const onOpenDeadline = vi.fn();
    renderDashboardBody({
      briefing: {
        ...makeBriefing([]),
        deadlines: {
          upcoming: [{
            id: "deadline-rec",
            title: "Recurring review",
            due_date: "2026-04-21",
            status: "open",
            is_recurring: true,
          }],
          stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
        },
      },
      ensureRange: vi.fn().mockResolvedValue([]),
      calendarDeadlines: {
        upcoming: [{
          id: "deadline-rec",
          title: "Recurring review",
          due_date: "2026-04-23",
          status: "open",
          is_recurring: true,
        }],
        stats: { incomplete: 1, dueToday: 0, dueThisWeek: 1, totalPoints: 0 },
      },
      onOpenDeadline,
    });

    expect(screen.queryByRole("button", { name: /deadline soon/i })).toBeNull();
    fireEvent.click(screen.getByTestId("hero-callout-deadline"));
    expect(onOpenDeadline).toHaveBeenCalledWith(expect.objectContaining({
      id: "deadline-rec",
      due_date: "2026-04-23",
    }), expect.any(HTMLElement));
  });

  it("deep links timeline events to the selected calendar chip", async () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const onOpenEventsCalendar = vi.fn();
    const event = {
      ...makeEvent(now, "Roadmap sync"),
      id: "event-1",
    };
    renderDashboardBody({
      briefing: makeBriefing([event]),
      ensureRange: vi.fn().mockResolvedValue([event]),
      onOpenEventsCalendar,
    });
    await act(async () => {});

    const timeline = screen.getByTestId("today-timeline");
    fireEvent.click(within(timeline).getByText("Roadmap sync"));

    expect(onOpenEventsCalendar).toHaveBeenCalledWith("2026-04-19", "event-1");
  });

  it("deep links bill rail rows to their schedule id and bill date", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const onOpenBillsCalendar = vi.fn();
    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn().mockResolvedValue([]),
      onOpenBillsCalendar,
      liveData: {
        liveBills: [
          {
            id: "schedule-rent",
            name: "Rent",
            payee: "Landlord",
            amount: 1800,
            next_date: "2026-04-20",
            paid: false,
          },
        ],
      },
    });

    fireEvent.click(screen.getAllByText("Rent").at(-1));

    expect(onOpenBillsCalendar).toHaveBeenCalledWith("2026-04-20", "schedule-rent");
  });

  it("refetches the live event window when calendar revision changes", async () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const ensureRange = vi.fn().mockResolvedValue([]);
    const briefing = makeBriefing([]);
    const { rerender } = render(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <DashboardBody
          briefing={briefing}
          liveData={{ liveBills: [], liveWeather: briefing.weather, liveEmails: [] }}
          calendarRange={{
            ensureRange,
            getEvents: vi.fn(),
            hasMonth: vi.fn(),
            isMonthLoading: vi.fn(),
            loading: false,
            error: null,
            revision: 0,
          }}
          customize={{
            dashboardLayout: "focus",
            density: "comfortable",
            showInsights: true,
            showInboxPeek: false,
          }}
          accent="#cba6da"
          isMobile={false}
          onOpenEmail={() => {}}
          onOpenDeadline={() => {}}
          onOpenBillsCalendar={() => {}}
          onOpenEventsCalendar={() => {}}
          onOpenDeadlinesCalendar={() => {}}
          onJumpSection={() => {}}
        />
      </DashboardProvider>,
    );

    expect(ensureRange).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <DashboardBody
          briefing={briefing}
          liveData={{ liveBills: [], liveWeather: briefing.weather, liveEmails: [] }}
          calendarRange={{
            ensureRange,
            getEvents: vi.fn(),
            hasMonth: vi.fn(),
            isMonthLoading: vi.fn(),
            loading: false,
            error: null,
            revision: 1,
          }}
          customize={{
            dashboardLayout: "focus",
            density: "comfortable",
            showInsights: true,
            showInboxPeek: false,
          }}
          accent="#cba6da"
          isMobile={false}
          onOpenEmail={() => {}}
          onOpenDeadline={() => {}}
          onOpenBillsCalendar={() => {}}
          onOpenEventsCalendar={() => {}}
          onOpenDeadlinesCalendar={() => {}}
          onJumpSection={() => {}}
        />
      </DashboardProvider>,
    );

    expect(ensureRange).toHaveBeenCalledTimes(2);
  });
});
