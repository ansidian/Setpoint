import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBody } from "./Dashboard";
import { DashboardProvider } from "../context/DashboardContext";
import type { DashboardDeadlineRoot } from "../context/dashboardTaskProjection";

interface EventFixture {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  color: string;
  location: string;
}

interface BriefingFixture {
  weather: { temp: number; condition: string; city: string };
  calendar: EventFixture[];
  deadlines: DashboardDeadlineRoot;
  emails: { summary: string; accounts: [] };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeEvent(now: number, title: string): EventFixture {
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

function makeBriefing(events: EventFixture[] = []): BriefingFixture {
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
  domainRefreshing = false,
}: {
  briefing: BriefingFixture;
  ensureRange: (start: string, end: string) => Promise<EventFixture[]>;
  onOpenBillsCalendar?: (...args: unknown[]) => void;
  onOpenDeadline?: (...args: unknown[]) => void;
  onOpenEventsCalendar?: (...args: unknown[]) => void;
  liveData?: { liveBills?: Array<Record<string, unknown>> };
  calendarDeadlines?: DashboardDeadlineRoot;
  calendarDeadlinesLoading?: boolean;
  calendarDeadlinesError?: boolean;
  domainRefreshing?: boolean;
}) {
  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
        liveData={{
        liveBills: [],
        liveWeather: briefing.weather,
        liveCalendar: briefing.calendar,
        liveDeadlines: briefing.deadlines,
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
        domainRefreshing={domainRefreshing}
        onOpenEmail={() => {}}
        onOpenDeadline={onOpenDeadline}
        onOpenBillsCalendar={onOpenBillsCalendar}
        onOpenEventsCalendar={onOpenEventsCalendar}
      />
    </DashboardProvider>,
  );
}

describe("Dashboard event loading", () => {
  it("shows the timeline refresh status while deadlines or bills refresh", async () => {
    renderDashboardBody({
      briefing: makeBriefing([]),
      ensureRange: vi.fn().mockResolvedValue([]),
      domainRefreshing: true,
    });
    await act(async () => {});

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps seeded events on the timeline while a warm refresh is in flight", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const event = makeEvent(now, "Seeded focus block");
    renderDashboardBody({
      briefing: makeBriefing([event]),
      ensureRange: vi.fn(() => new Promise<EventFixture[]>(() => {})),
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
      ensureRange: vi.fn(() => new Promise<EventFixture[]>(() => {})),
    });

    expect(screen.getByTestId("dashboard-event-skeletons")).toBeTruthy();
    // The deadline still surfaces in the context column's Coming-up list, but the
    // timeline itself holds the skeleton rather than degrading to deadlines-only.
    expect(screen.getAllByText("Essay").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("today-timeline")).queryByText("Essay")).toBeNull();
    expect(screen.queryByTestId("timeline-refresh-status")).toBeNull();
  });

  it("holds the timeline skeleton while an empty deadline feed is still loading", async () => {
    const briefing = makeBriefing([]);
    briefing.deadlines = { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    renderDashboardBody({
      briefing,
      ensureRange: vi.fn().mockResolvedValue([]),
      calendarDeadlinesLoading: true,
    });
    await act(async () => {});

    const timeline = screen.getByTestId("today-timeline");
    expect(within(timeline).getByTestId("dashboard-event-skeletons")).toBeTruthy();
    expect(within(timeline).queryByText("Nothing on the calendar matching this filter.")).toBeNull();
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
    // Second arg is the clicked element, the desktop glance-sheet anchor.
    expect(onOpenDeadline).toHaveBeenCalledWith(expect.objectContaining({
      id: "deadline-rec",
      due_date: "2026-04-23",
    }), expect.anything());
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

    // The tapped event record is carried as a 3rd arg so the shell can open it in
    // the in-place glance sheet; the 4th arg is the clicked element (desktop anchor).
    expect(onOpenEventsCalendar).toHaveBeenCalledWith("2026-04-19", "event-1", expect.objectContaining({ id: "event-1" }), expect.anything());
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

    const rentRows = screen.getAllByText("Rent");
    fireEvent.click(rentRows[rentRows.length - 1]!);

    // The tapped bill record is carried as a 3rd arg (powers the in-place glance
    // sheet); the 4th arg is the clicked element (desktop anchor).
    expect(onOpenBillsCalendar).toHaveBeenCalledWith("2026-04-20", "schedule-rent", expect.objectContaining({ name: "Rent", next_date: "2026-04-20" }), expect.anything());
  });

});
