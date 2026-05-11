import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadlinesRail from "./DeadlinesRail.jsx";

afterEach(() => {
  vi.useRealTimers();
});

describe("DeadlinesRail", () => {
  it("shows reminder indicators only for open rows with upcoming reminders", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T16:00:00.000Z"));
    render(
      <DeadlinesRail
        accent="#cba6da"
        deadlines={[
          {
            id: "todo-reminder",
            title: "Prep packet",
            due_date: "2026-05-06",
            source: "todoist",
            status: "open",
            hasUpcomingReminder: true,
            upcomingReminderCount: 2,
            nextReminderAt: "2026-05-05T21:30:00.000Z",
          },
          {
            id: "todo-fired",
            title: "Already pinged",
            due_date: "2026-05-06",
            source: "todoist",
            status: "open",
            hasUpcomingReminder: false,
            upcomingReminderCount: 0,
            nextReminderAt: null,
          },
        ]}
        onJump={() => {}}
      />,
    );

    const indicator = screen.getByTestId("dashboard-reminder-indicator");
    expect(indicator.textContent).toContain("Reminder");
    expect(indicator.textContent).toContain("in 5h 30m");
    expect(screen.getByText("Already pinged").closest("[role='button']")?.textContent).not.toContain("Reminder");
  });
});
