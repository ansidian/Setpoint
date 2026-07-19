import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import type { DashboardDeadline } from "./dashboardTaskProjection";
import { completeDeadlineOccurrence, updateDeadline } from "../api";
import type { CompleteDeadlineOccurrenceResult, TodoistTask } from "../../shared/types/tasks";

vi.mock("../api", () => ({
  completeDeadlineOccurrence: vi.fn(),
  updateDeadline: vi.fn(),
}));

const completeDeadlineOccurrenceMock = vi.mocked(completeDeadlineOccurrence);
const updateDeadlineMock = vi.mocked(updateDeadline);
const completedOccurrence: CompleteDeadlineOccurrenceResult = {
  completed: true,
  alreadyCompleted: false,
  deadlineId: "test-deadline",
  occurrenceDate: "2026-04-21",
};
const updatedTaskResult = {} as TodoistTask;

function Probe({ task, moveTarget = "2026-04-25" }: { task: DashboardDeadline; moveTarget?: string }) {
  const { handleAddTask, handleCompleteTask, handleUpdateTask, handleDeleteTask, handleMoveTask } = useDashboard();
  return (
    <>
      <button type="button" onClick={() => handleAddTask(task)}>
        Add
      </button>
      <button type="button" onClick={() => handleCompleteTask(task.id, task)}>
        Complete
      </button>
      <button type="button" onClick={() => handleUpdateTask({ ...task, title: "Updated title" })}>
        Update
      </button>
      <button type="button" onClick={() => handleDeleteTask(task.id)}>
        Delete
      </button>
      <button type="button" onClick={() => handleMoveTask(task, moveTarget)}>
        Move
      </button>
    </>
  );
}

describe("DashboardContext deadline single-owner state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    completeDeadlineOccurrenceMock.mockResolvedValue(completedOccurrence);
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("moves a deadline to the target day and persists with the time preserved", async () => {
    const task = {
      id: "todo-move",
      title: "Timed task",
      due_date: "2026-04-21",
      due_time: "3:00 PM",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    updateDeadlineMock.mockResolvedValue(updatedTaskResult);

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} moveTarget="2026-04-25" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    // Optimistic: the deadline's due_date shifts to the target day so the
    // calendar re-buckets the chip immediately.
    const movedDeadlines = setCalendarDeadlines.mock.results[0]!.value;
    expect(movedDeadlines.upcoming[0]).toMatchObject({
      id: "todo-move",
      due_date: "2026-04-25",
    });
    // Persist re-supplies the time so the day-only move keeps it (not all-day).
    expect(updateDeadline).toHaveBeenCalledWith("todo-move", { dueDate: "2026-04-25", dueTime: "3:00 PM" });
  });

  it("reverts the optimistic move when the server rejects", async () => {
    const task = {
      id: "todo-move-fails",
      title: "Move-rejects task",
      due_date: "2026-04-21",
      due_time: "3:00 PM",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    updateDeadlineMock.mockRejectedValue(new Error("provider down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} moveTarget="2026-04-25" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    // Optimistic shift happened, then the rejection rolled the due_date back.
    expect(updateDeadline).toHaveBeenCalledWith("todo-move-fails", { dueDate: "2026-04-25", dueTime: "3:00 PM" });
    const revertedDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(revertedDeadlines.upcoming[0]).toMatchObject({
      id: "todo-move-fails",
      due_date: "2026-04-21",
    });

    errorSpy.mockRestore();
  });

  it("ignores a same-day move (no optimistic write, no network call)", async () => {
    const task = {
      id: "todo-move-noop",
      title: "Same-day move",
      due_date: "2026-04-21",
      due_time: "3:00 PM",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} moveTarget="2026-04-21" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    expect(updateDeadline).not.toHaveBeenCalled();
    expect(setCalendarDeadlines).not.toHaveBeenCalled();
  });

  it("persists with the live cache due_time when the task is edited between drag-start and drop", async () => {
    // A task is dragged (snapshot has due_time: "3:00 PM") and dropped after being
    // edited in the row (live cache now has due_time: "4:00 PM"). The persistence
    // must use the live cache's time (the source of truth), not the stale drag snapshot.
    const dragSnapshot = {
      id: "todo-stale-time",
      title: "Timed task",
      due_date: "2026-04-21",
      due_time: "3:00 PM",
      status: "incomplete",
    };
    const liveTask = {
      id: "todo-stale-time",
      title: "Timed task",
      due_date: "2026-04-21",
      due_time: "4:00 PM",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [liveTask],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    updateDeadlineMock.mockResolvedValue(updatedTaskResult);

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={dragSnapshot} moveTarget="2026-04-25" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    // The persistence must use the live cache time (4:00 PM), not the stale snapshot time (3:00 PM).
    expect(updateDeadline).toHaveBeenCalledWith("todo-stale-time", { dueDate: "2026-04-25", dueTime: "4:00 PM" });
  });

  it("optimistically lands a full chip (with title) when the target cache lacks the task", async () => {
    // Reproduces a cross-month move: the per-month range cache the updater runs
    // against does NOT already hold the task, so the optimistic upsert takes its
    // push branch. The payload must carry the full task — a minimal {id,due_date}
    // would render as an "Untitled" stub in the target month's preview block.
    const task = {
      id: "todo-cross",
      title: "Pay rent",
      due_date: "2026-04-21",
      due_time: "3:00 PM",
      status: "incomplete",
    };
    const targetMonthCache = {
      upcoming: [],
      stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(targetMonthCache));
    updateDeadlineMock.mockResolvedValue(updatedTaskResult);

    render(
      <DashboardProvider deadlines={targetMonthCache} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} moveTarget="2026-04-25" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    const moved = setCalendarDeadlines.mock.results[0]!.value;
    expect(moved.upcoming[0]).toMatchObject({
      id: "todo-cross",
      due_date: "2026-04-25",
      title: "Pay rent",
    });
  });
});
