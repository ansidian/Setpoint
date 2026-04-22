import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    model: "Claude",
    aiInsights: [],
    weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
    calendar: events,
    ctm: { upcoming: [{ id: "ctm-1", title: "Essay", due_date: "2026-04-20", source: "canvas", status: "open" }] },
    todoist: { upcoming: [] },
    emails: { summary: "", accounts: [] },
  };
}

function renderDashboardBody({
  briefing,
  ensureRange,
  onOpenDeadlinesCalendar = () => {},
  liveData: liveDataOverrides = {},
}) {
  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
        briefing={briefing}
        liveData={{
          liveBills: [],
          liveWeather: briefing.weather,
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
        onOpenEmail={() => {}}
        onOpenDeadline={() => {}}
        onOpenBillsCalendar={() => {}}
        onOpenEventsCalendar={() => {}}
        onOpenDeadlinesCalendar={onOpenDeadlinesCalendar}
        onJumpSection={() => {}}
      />
    </DashboardProvider>,
  );
}

describe("Dashboard event loading", () => {
  it("renders seeded briefing events immediately while live refresh is pending", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const event = makeEvent(now, "Seeded focus block");
    renderDashboardBody({
      briefing: makeBriefing([event]),
      ensureRange: vi.fn(() => new Promise(() => {})),
    });

    expect(screen.getAllByText("Seeded focus block").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("dashboard-event-skeletons")).toBeNull();
    expect(screen.getByTestId("focus-window-refresh-status")).toBeTruthy();
    expect(screen.getByTestId("timeline-refresh-status")).toBeTruthy();
    expect(screen.getAllByText("Updating Google Calendar").length).toBe(2);
  });

  it("shows event skeletons only when there is no seed data and the first fetch is pending", () => {
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

  it("deep links the pressure pill to the nearest deadline day", () => {
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
    expect(onOpenDeadlinesCalendar).toHaveBeenCalledWith("2026-04-20");
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
