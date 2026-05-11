import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TimelineRow from "./TimelineRow.jsx";

describe("TimelineRow", () => {
  it("renders reminder indicators only for timeline items with upcoming reminders", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const upcomingEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T22:00:00.000Z").getTime(),
      endMs: new Date("2026-05-05T23:00:00.000Z").getTime(),
      data: {
        id: "event-reminder",
        title: "Roadmap sync",
        startMs: new Date("2026-05-05T22:00:00.000Z").getTime(),
        endMs: new Date("2026-05-05T23:00:00.000Z").getTime(),
        hasUpcomingReminder: true,
        upcomingReminderCount: 1,
        nextReminderAt: "2026-05-05T21:30:00.000Z",
      },
    };
    const firedDeadline = {
      kind: "deadline",
      dueAtMs: new Date("2026-05-06T06:59:00.000Z").getTime(),
      data: {
        id: "deadline-fired",
        title: "Already pinged",
        due_date: "2026-05-05",
        source: "todoist",
        status: "open",
        hasUpcomingReminder: false,
        upcomingReminderCount: 0,
        nextReminderAt: null,
      },
    };

    render(
      <>
        <TimelineRow accent="#cba6da" item={upcomingEvent} now={now} />
        <TimelineRow accent="#cba6da" item={firedDeadline} now={now} />
      </>,
    );

    const indicator = screen.getByTestId("dashboard-reminder-indicator");
    expect(indicator.textContent).toContain("Reminder");
    expect(indicator.textContent).toContain("in 1h 5m");
    expect(screen.getByText("Already pinged").closest("[role='button']")?.textContent).not.toContain("Reminder");
  });

  it("renders all-day events as all-day rather than timed live blocks", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const allDayEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      data: {
        id: "cinco",
        title: "Cinco de Mayo",
        allDay: true,
        startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
        endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      },
    };

    render(<TimelineRow accent="#cba6da" item={allDayEvent} now={now} />);

    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.queryByText("5:00 am")).toBeNull();
    expect(screen.queryByText("24h")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });
});
