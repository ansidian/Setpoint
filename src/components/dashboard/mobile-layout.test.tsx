import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TodayTimeline from "./TodayTimeline";
import { DashboardProvider } from "../../context/DashboardContext";
import { DashboardBody } from "../../pages/Dashboard";

afterEach(() => {
  cleanup();
  // Restore real timers so a test's fake clock cannot leak into a sibling under
  // shuffled order (this repo does not auto-restore between tests).
  vi.useRealTimers();
});

function makeBriefing(overrides = {}) {
  return {
    weather: { temp: 71, condition: "Sunny", city: "Los Angeles" },
    calendar: [],
    deadlines: {
      upcoming: [
        { id: "deadline-1", title: "Reply to recruiter", due_date: "2026-04-19", priority: 1, status: "open" as const },
      ],
    },
    emails: {
      summary: "The day is manageable if you handle the near-term deadlines first.",
      accounts: [
        {
          important: [
            {
              id: "email-1",
              subject: "Need approval on the revised timeline",
              from: "Alex",
              date: "2026-04-19T15:30:00.000Z",
              read: false,
            },
          ],
          unread: 1,
        },
      ],
    },
    ...overrides,
  };
}

function renderDashboardBody({ isMobile = false, onOpenEmail = () => {} } = {}) {
  const briefing = makeBriefing();
  const liveData = {
    liveBills: [{ id: "bill-1", name: "Rent", amount: 1800, next_date: "2026-04-21", payee: "Landlord", paid: false }],
    liveWeather: briefing.weather,
    liveCalendar: briefing.calendar,
    liveDeadlines: briefing.deadlines,
    liveEmails: [],
  };

  return render(
    <DashboardProvider briefing={briefing} setBriefing={() => {}} setCalendarDeadlines={() => {}}>
      <DashboardBody
        liveData={liveData}
        calendarRange={{
          ensureRange: vi.fn().mockResolvedValue([]),
          getEvents: vi.fn(),
          hasMonth: vi.fn(),
          isMonthLoading: vi.fn(),
          loading: false,
          error: null,
        }}
        accent="#cba6da"
        isMobile={isMobile}
        onOpenEmail={onOpenEmail}
        onOpenDeadline={() => {}}
        onOpenBillsCalendar={() => {}}
        onOpenEventsCalendar={() => {}}
      />
    </DashboardProvider>,
  );
}

describe("mobile dashboard 3-tier layout", () => {
  it("stacks the three tiers on mobile", () => {
    renderDashboardBody({ isMobile: true });
    const body = screen.getByTestId("dashboard-body-mobile");
    expect(body.getAttribute("data-layout-mode")).toBe("mobile");
    expect(screen.getByTestId("needs-you-band")).toBeTruthy();
    expect(screen.getByTestId("today-timeline-mobile")).toBeTruthy();
    expect(screen.getByTestId("dashboard-context-column")).toBeTruthy();
    expect(document.querySelector('[data-sect="deadlines"]')).toBeNull();
    expect(document.querySelector('[data-sect="bills"]')).toBeNull();
  });

  it("renders the fixed desktop 3-tier layout with the 344px context column", () => {
    renderDashboardBody({ isMobile: false });
    expect(document.querySelector('[data-layout-mode="desktop"]')).toBeTruthy();
    expect(screen.getByTestId("needs-you-band")).toBeTruthy();
    expect(screen.getByTestId("today-timeline")).toBeTruthy();
    expect(screen.getByTestId("dashboard-context-column")).toBeTruthy();
  });
});

describe("TodayTimeline controls", () => {
  it("toggles a filter chip off when clicked", () => {
    render(
      <TodayTimeline
        accent="#cba6da"
        events={[]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    const deadlinesFilter = screen.getByRole("switch", { name: /deadlines/i });
    expect(deadlinesFilter.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(deadlinesFilter);

    expect(deadlinesFilter.getAttribute("aria-checked")).toBe("false");
  });

  it("expands the rest-of-this-week disclosure to reveal its items on click", () => {
    // Pin the clock so a Thursday event lands in the rest-of-week bucket (day 3).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T16:00:00.000Z").getTime());

    render(
      <TodayTimeline
        accent="#cba6da"
        events={[
          {
            id: "rest-ev",
            title: "Thursday review",
            startMs: new Date("2026-05-14T18:00:00.000Z").getTime(),
            endMs: new Date("2026-05-14T19:00:00.000Z").getTime(),
          },
        ]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    const timeline = screen.getByTestId("today-timeline");
    const toggle = screen.getByRole("button", { name: /rest of this week/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(timeline.textContent).not.toMatch(/Thursday review/);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(timeline.textContent).toMatch(/Thursday review/);
  });

  it("renders a standalone NOW marker in a focus-window gap between events", () => {
    // Pin now (1pm PDT) between a finished morning event and an upcoming one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T20:00:00.000Z").getTime());

    render(
      <TodayTimeline
        accent="#cba6da"
        events={[
          {
            id: "past-ev",
            title: "Morning standup",
            startMs: new Date("2026-05-11T17:00:00.000Z").getTime(),
            endMs: new Date("2026-05-11T18:00:00.000Z").getTime(),
          },
          {
            id: "future-ev",
            title: "Afternoon review",
            startMs: new Date("2026-05-11T22:00:00.000Z").getTime(),
            endMs: new Date("2026-05-11T23:00:00.000Z").getTime(),
          },
        ]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("timeline-gap-now-marker")).toBeTruthy();
    // Nothing is live, so the in-card progress-line marker is absent.
    expect(screen.queryByTestId("timeline-now-marker")).toBeNull();
  });

  it("shows the in-card now marker inside a live event row", () => {
    // Pin the clock to the middle of the event so the now marker renders.
    vi.useFakeTimers();
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    vi.setSystemTime(now);

    const liveEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T20:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T21:00:00.000Z").getTime(),
      data: {
        id: "focus",
        title: "Focus block",
        startMs: new Date("2026-05-05T20:00:00.000Z").getTime(),
        endMs: new Date("2026-05-05T21:00:00.000Z").getTime(),
      },
    };

    render(
      <TodayTimeline
        accent="#cba6da"
        events={[liveEvent]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("timeline-now-marker")).toBeTruthy();
  });
});

describe("TodayTimeline mobile layout", () => {
  it("uses the mobile timeline row for mobile events", () => {
    // Pin the clock to the event's day so the timeline keeps it (TodayTimeline
    // drops items whose day-bucket is before "today"). Without this the test
    // only passed when a sibling's fake clock leaked into it under sorted order.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T16:00:00.000Z").getTime());

    render(
      <TodayTimeline
        accent="#cba6da"
        isMobile
        events={[
          {
            id: "ev-1",
            title: "Staff sync",
            startMs: new Date("2026-04-19T18:00:00.000Z").getTime(),
            endMs: new Date("2026-04-19T18:30:00.000Z").getTime(),
            location: "Zoom",
          },
        ]}
        deadlines={[]}
        onJump={() => {}}
      />,
    );

    const row = screen.getByTestId("timeline-row-mobile");

    expect(row.textContent).toMatch(/Staff sync/);
    expect(row.textContent).toMatch(/Zoom/);
    expect(screen.queryByTestId("timeline-row-desktop")).toBeNull();
  });
});
