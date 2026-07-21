import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsAgendaDeadlineRow from "./EventsAgendaDeadlineRow.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EventsAgendaDeadlineRow", () => {
  it("shows reminder timing only for deadline overlay rows with upcoming reminders", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T19:00:00.000Z"));

    render(
      <>
        <EventsAgendaDeadlineRow
          deadline={{
            id: "todo-reminder",
            agendaItemId: "todoist:todo-reminder",
            agendaTitle: "Prep packet",
            agendaSubtitle: "Todoist",
            agendaTimeRange: "Todoist",
            agendaSourceColor: "#e8776a",
            agendaStatus: "Incomplete",
            hasUpcomingReminder: true,
            upcomingReminderCount: 1,
            nextReminderAt: "2026-05-12T15:30:00.000Z",
          }}
          dateKey="2026-05-12"
          selected={false}
          registerRow={() => {}}
          onSelect={() => {}}
        />
        <EventsAgendaDeadlineRow
          deadline={{
            id: "todo-fired",
            agendaItemId: "todoist:todo-fired",
            agendaTitle: "Already pinged",
            agendaSubtitle: "Todoist",
            agendaTimeRange: "Todoist",
            agendaSourceColor: "#e8776a",
            agendaStatus: "Incomplete",
            hasUpcomingReminder: false,
            upcomingReminderCount: 0,
            nextReminderAt: null,
          }}
          dateKey="2026-05-12"
          selected={false}
          registerRow={() => {}}
          onSelect={() => {}}
        />
      </>,
    );

    const indicator = screen.getByTestId("calendar-agenda-reminder-label");
    expect(indicator.textContent).toContain("Reminder");
    expect(indicator.textContent).toContain("May 12");
    expect(screen.getByText("Already pinged").closest("button")?.textContent).not.toContain("Reminder");
  });

  it("renders in-progress and completed deadline status without tooltip chrome", () => {
    const registerRow = vi.fn();
    const onSelect = vi.fn();

    render(
      <>
        <EventsAgendaDeadlineRow
          deadline={{
            id: "todo-0",
            agendaItemId: "deadline:todo-0:2026-05-12",
            agendaTitle: "Draft essay",
            agendaSubtitle: "School",
            agendaTimeRange: "School",
            agendaSourceColor: "#5A8FBF",
            agendaStatus: "In progress",
            agendaStatusIcon: "in_progress",
            agendaComplete: false,
          }}
          dateKey="2026-05-12"
          selected={false}
          registerRow={registerRow}
          onSelect={onSelect}
        />
        <EventsAgendaDeadlineRow
          deadline={{
            id: "todo-1",
            agendaItemId: "todoist:todo-1",
            agendaTitle: "Submit report",
            agendaSubtitle: "Todoist",
            agendaTimeRange: "Todoist",
            agendaSourceColor: "#e8776a",
            agendaStatus: "Complete",
            agendaStatusIcon: "complete",
            agendaComplete: true,
          }}
          dateKey="2026-05-12"
          selected={false}
          registerRow={registerRow}
          onSelect={onSelect}
        />
      </>,
    );

    const progressStatus = screen.getByTestId("events-agenda-deadline-status-deadline:todo-0:2026-05-12");
    const completeStatus = screen.getByTestId("events-agenda-deadline-status-todoist:todo-1");
    expect(progressStatus.textContent).toContain("In progress");
    expect(progressStatus.querySelector("[data-events-agenda-deadline-status-icon='in_progress']")?.getAttribute("aria-hidden")).toBe("true");
    expect(progressStatus.getAttribute("title")).toBeNull();
    expect(completeStatus.textContent).toContain("Complete");
    expect(screen.getByText("Submit report").closest("s")).toBeTruthy();

    fireEvent.click(screen.getByText("Draft essay"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "todo-0" }), expect.any(HTMLButtonElement));
  });
});
