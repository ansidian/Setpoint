import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext.jsx";

vi.mock("../api", () => ({
  dismissEmail: vi.fn(),
  completeTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  dismissTombstone: vi.fn(),
}));

function Probe({ task }) {
  const { handleAddTask } = useDashboard();
  return (
    <button type="button" onClick={() => handleAddTask(task)}>
      Add
    </button>
  );
}

describe("DashboardContext Todoist local state", () => {
  it("adds Todoist tasks to calendar deadlines without waiting for a refetch", () => {
    const task = {
      id: "todo-new",
      title: "New task",
      due_date: "2026-04-21",
      status: "incomplete",
      source: "todoist",
    };
    const setBriefing = vi.fn((updater) => updater({
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    }));
    const setCalendarDeadlines = vi.fn((updater) => updater(null));

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] }, ctm: { upcoming: [] }, todoist: { upcoming: [] } }}
        setBriefing={setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Add"));

    expect(setCalendarDeadlines).toHaveBeenCalled();
    const nextDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(nextDeadlines.todoist.upcoming).toEqual([task]);
    expect(nextDeadlines.todoist.stats.incomplete).toBe(1);
  });
});
