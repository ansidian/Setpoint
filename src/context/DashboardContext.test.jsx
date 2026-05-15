import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext.jsx";
import { completeDeadlineOccurrence } from "../api";

vi.mock("../api", () => ({
  dismissEmail: vi.fn(),
  completeDeadlineOccurrence: vi.fn(),
}));

function Probe({ task }) {
  const { handleAddTask, handleCompleteTask, handleUpdateTaskStatus } = useDashboard();
  return (
    <>
      <button type="button" onClick={() => handleAddTask(task)}>
        Add
      </button>
      <button type="button" onClick={() => handleCompleteTask(task.id, task)}>
        Complete
      </button>
      <output data-testid="status-handler">{String(typeof handleUpdateTaskStatus)}</output>
    </>
  );
}

describe("DashboardContext deadline local state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    completeDeadlineOccurrence.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("adds deadlines to calendar deadlines without waiting for a refetch", () => {
    const task = {
      id: "todo-new",
      title: "New task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const setBriefing = vi.fn((updater) => updater({
      emails: { accounts: [] },
      deadlines: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    }));
    const setCalendarDeadlines = vi.fn((updater) => updater(null));

    render(
      <DashboardProvider
        briefing={{ emails: { accounts: [] }, deadlines: { upcoming: [] } }}
        setBriefing={setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Add"));

    expect(setCalendarDeadlines).toHaveBeenCalled();
    const nextDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(nextDeadlines.upcoming).toEqual([task]);
    expect(nextDeadlines.stats.incomplete).toBe(1);
  });

  it("optimistically completes deadline occurrences that are present only in calendar deadlines", async () => {
    const task = {
      id: "todo-range-only",
      title: "Range-only task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const briefing = {
      emails: { accounts: [] },
      deadlines: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setBriefing = vi.fn((updater) => updater(briefing));
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompleted = vi.fn();
    const onTaskCompletionIntent = vi.fn();

    render(
      <DashboardProvider
        briefing={briefing}
        setBriefing={setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompleted={onTaskCompleted}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    expect(screen.getByTestId("status-handler").textContent).toBe("undefined");

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).toHaveBeenCalledWith("todo-range-only", "2026-04-21");
    expect(onTaskCompletionIntent).toHaveBeenCalledWith("todo-range-only");
    const completingDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(completingDeadlines.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      _completing: true,
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(onTaskCompleted).toHaveBeenCalledWith("todo-range-only");
    const completedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
    expect(completedDeadlines.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      status: "complete",
    });
    expect(completedDeadlines.upcoming[0]._completing).toBeUndefined();
  });
});
