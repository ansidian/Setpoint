import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext.jsx";
import { completeTask, updateTaskStatus } from "../api";

vi.mock("../api", () => ({
  dismissEmail: vi.fn(),
  completeTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  dismissTombstone: vi.fn(),
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
      <button type="button" onClick={() => handleUpdateTaskStatus(task.id, "complete")}>
        Complete status
      </button>
    </>
  );
}

describe("DashboardContext Todoist local state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    completeTask.mockResolvedValue({});
    updateTaskStatus.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

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

  it("optimistically completes Todoist tasks that are present only in calendar deadlines", async () => {
    const task = {
      id: "todo-range-only",
      title: "Range-only task",
      due_date: "2026-04-21",
      status: "incomplete",
      source: "todoist",
    };
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    };
    const deadlines = {
      ctm: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
      todoist: { upcoming: [task], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    };
    const setBriefing = vi.fn((updater) => updater(briefing));
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider
        briefing={briefing}
        setBriefing={setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeTask).toHaveBeenCalledWith("todo-range-only");
    const completingDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(completingDeadlines.todoist.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      _completing: true,
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600);
    });

    const completedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
    expect(completedDeadlines.todoist.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      status: "complete",
    });
    expect(completedDeadlines.todoist.upcoming[0]._completing).toBeUndefined();
  });

  it("optimistically completes CTM rows through the generic status action without touching Todoist rows", async () => {
    const task = {
      id: "shared-id",
      title: "Canvas task",
      due_date: "2026-04-21",
      status: "incomplete",
      source: "canvas",
    };
    const todoistTask = {
      id: "shared-id",
      title: "Todoist task with matching id",
      due_date: "2026-04-21",
      status: "incomplete",
      source: "todoist",
    };
    const briefing = {
      emails: { accounts: [] },
      ctm: { upcoming: [] },
      todoist: { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    };
    const deadlines = {
      ctm: { upcoming: [task], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
      todoist: { upcoming: [todoistTask], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } },
    };
    const setBriefing = vi.fn((updater) => updater(briefing));
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider
        briefing={briefing}
        setBriefing={setBriefing}
        setCalendarDeadlines={setCalendarDeadlines}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Complete status"));

    expect(updateTaskStatus).toHaveBeenCalledWith("shared-id", "complete");
    const completingDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(completingDeadlines.ctm.upcoming[0]).toMatchObject({
      id: "shared-id",
      _completing: true,
    });
    expect(completingDeadlines.todoist.upcoming[0]._completing).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const completedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
    expect(completedDeadlines.ctm.upcoming[0]).toMatchObject({
      id: "shared-id",
      status: "complete",
    });
    expect(completedDeadlines.todoist.upcoming[0].status).toBe("incomplete");
  });
});
