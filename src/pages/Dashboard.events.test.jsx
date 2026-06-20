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
  onOpenEventsCalendar = () => {},
  liveData: liveDataOverrides = {},
  calendarDeadlines = undefined,
  calendarDeadlinesLoading = false,
  calendarDeadlinesError = false,
}) {
  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
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
        accent="#cba6da"
        isMobile={false}
        calendarDeadlines={calendarDeadlines}
        calendarDeadlinesLoading={calendarDeadlinesLoading}
        calendarDeadlinesError={calendarDeadlinesError}
        onOpenEmail={() => {}}
        onOpenDeadline={onOpenDeadline}
        onOpenBillsCalendar={onOpenBillsCalendar}
        onOpenEventsCalendar={onOpenEventsCalendar}
      />
    </DashboardProvider>,
  );
}

describe("Dashboard event loading", () => {
  it("keeps seeded events on the timeline while a warm refresh is in flight", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const event = makeEvent(now, "Seeded focus block");
    renderDashboardBody({
      briefing: makeBriefing([event]),
      ensureRange: vi.fn(() => new Promise(() => {})),
    });

    // With seeded events present the timeline keeps showing them and drops the
    // skeleton, while still surfacing the refresh-in-flight status row.
    expect(within(screen.getByTestId("today-timeline")).getByText("Seeded focus block")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-event-skeletons")).toBeNull();
    expect(screen.getByTestId("timeline-refresh-status")).toBeTruthy();
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
    // The deadline still surfaces in the context column's Coming-up list, but the
    // timeline itself holds the skeleton rather than degrading to deadlines-only.
    expect(screen.getAllByText("Essay").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("today-timeline")).queryByText("Essay")).toBeNull();
    expect(screen.queryByTestId("timeline-refresh-status")).toBeNull();
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

    // The context column's Coming-up list opens the live (calendar) record, not
    // the stale briefing one, through onJump -> handleRailJump -> onOpenDeadline.
    const comingUp = screen.getByTestId("context-coming-up");
    fireEvent.click(within(comingUp).getByText("Recurring review"));
    expect(onOpenDeadline).toHaveBeenCalledWith(expect.objectContaining({
      id: "deadline-rec",
      due_date: "2026-04-23",
    }), undefined);
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

  it("deep links coming-up bill rows to their schedule id and bill date", () => {
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
          accent="#cba6da"
          isMobile={false}
          onOpenEmail={() => {}}
          onOpenDeadline={() => {}}
          onOpenBillsCalendar={() => {}}
          onOpenEventsCalendar={() => {}}
        />
      </DashboardProvider>,
    );

    expect(ensureRange).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
        <DashboardBody
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
          accent="#cba6da"
          isMobile={false}
          onOpenEmail={() => {}}
          onOpenDeadline={() => {}}
          onOpenBillsCalendar={() => {}}
          onOpenEventsCalendar={() => {}}
        />
      </DashboardProvider>,
    );

    expect(ensureRange).toHaveBeenCalledTimes(2);
  });
});
