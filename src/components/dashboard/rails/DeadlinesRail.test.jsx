import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadlinesRail from "./DeadlinesRail.jsx";

afterEach(() => {
  vi.useRealTimers();
});

describe("DeadlinesRail", () => {
  it("does not clip the desktop deadline preview list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T16:00:00.000Z"));

    render(
      <DeadlinesRail
        accent="#cba6da"
        deadlines={[
          { id: "open-1", title: "Check-in", due_date: "2026-05-06", status: "open" },
          { id: "open-2", title: "Submit Timesheet", due_date: "2026-05-17", status: "open" },
          { id: "done-1", title: "Chase Prime Visa statement", due_date: "2026-06-11", status: "complete" },
          { id: "done-2", title: "SCE CARE recertification", due_date: "2026-07-10", status: "complete" },
        ]}
        onJump={() => {}}
      />,
    );

    const list = screen.getByTestId("deadlines-rail-list");
    expect(list.style.maxHeight).toBe("");
    expect(list.style.overflow).toBe("");
    expect(screen.getByText("SCE CARE recertification")).toBeTruthy();
  });

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
