import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import type { DashboardDeadline } from "./dashboardTaskProjection";
import { completeDeadlineOccurrence } from "../api";
import type { CompleteDeadlineOccurrenceResult } from "../../shared/types/tasks";

vi.mock("../api", () => ({
  completeDeadlineOccurrence: vi.fn(),
  updateDeadline: vi.fn(),
}));

const completeDeadlineOccurrenceMock = vi.mocked(completeDeadlineOccurrence);
const completedOccurrence: CompleteDeadlineOccurrenceResult = {
  completed: true,
  alreadyCompleted: false,
  deadlineId: "test-deadline",
  occurrenceDate: "2026-04-21",
};

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

  it("adds deadlines to calendar deadlines without waiting for a refetch", () => {
    const task = {
      id: "todo-new",
      title: "New task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Add"));

    expect(setCalendarDeadlines).toHaveBeenCalled();
    const nextDeadlines = setCalendarDeadlines.mock.results[0]!.value;
    expect(nextDeadlines.upcoming).toEqual([task]);
    expect(nextDeadlines.stats.incomplete).toBe(1);
  });

  it("optimistically completes deadline occurrences through the single deadlines store", async () => {
    const task = {
      id: "todo-range-only",
      title: "Range-only task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompleted = vi.fn();
    const onTaskCompletionIntent = vi.fn();

    render(
      <DashboardProvider
        deadlines={deadlines}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompleted={onTaskCompleted}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).toHaveBeenCalledWith("todo-range-only", "2026-04-21");
    expect(onTaskCompletionIntent).toHaveBeenCalledWith("todo-range-only");
    const completingDeadlines = setCalendarDeadlines.mock.results[0]!.value;
    expect(completingDeadlines.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      _completing: true,
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(onTaskCompleted).toHaveBeenCalledWith("todo-range-only");
    const completedDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(completedDeadlines.upcoming[0]).toMatchObject({
      id: "todo-range-only",
      status: "complete",
    });
    expect(completedDeadlines.upcoming[0]._completing).toBeUndefined();
  });

  it("routes update and delete through the same deadlines store", () => {
    const task = {
      id: "todo-edit",
      title: "Original title",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Update"));
    const updatedDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(updatedDeadlines.upcoming[0].title).toBe("Updated title");

    fireEvent.click(screen.getByText("Delete"));
    const remainingDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(remainingDeadlines.upcoming).toEqual([]);
  });

  it("handleCompleteTask resolves true on success and false when completeDeadlineOccurrence rejects", async () => {
    const successTask = {
      id: "todo-return-true",
      title: "Succeeds",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const failTask = {
      id: "todo-return-false",
      title: "Fails",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    let capturedResult: boolean | undefined;

    function ReturnProbe({ task }: { task: DashboardDeadline }) {
      const { handleCompleteTask } = useDashboard();
      return (
        <button
          type="button"
          onClick={async () => {
            capturedResult = await handleCompleteTask(task.id, task);
          }}
        >
          CompleteAndCapture
        </button>
      );
    }

    // Success case.
    const successDeadlines = { upcoming: [successTask], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlinesSuccess = vi.fn((updater) => updater(successDeadlines));
    completeDeadlineOccurrenceMock.mockResolvedValueOnce(completedOccurrence);

    const { unmount } = render(
      <DashboardProvider deadlines={successDeadlines} setCalendarDeadlines={setCalendarDeadlinesSuccess}>
        <ReturnProbe task={successTask} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("CompleteAndCapture"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(capturedResult).toBe(true);
    unmount();

    // Failure case.
    const failDeadlines = { upcoming: [failTask], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlinesFail = vi.fn((updater) => updater(failDeadlines));
    completeDeadlineOccurrenceMock.mockRejectedValueOnce(new Error("provider down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <DashboardProvider deadlines={failDeadlines} setCalendarDeadlines={setCalendarDeadlinesFail}>
        <ReturnProbe task={failTask} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("CompleteAndCapture"));
    });

    expect(capturedResult).toBe(false);
    errorSpy.mockRestore();
  });

  it("reverts the optimistic completing flag and never completes when the server rejects", async () => {
    const task = {
      id: "todo-fails",
      title: "Server-rejects task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompleted = vi.fn();
    const onTaskCompletionIntent = vi.fn();
    completeDeadlineOccurrenceMock.mockRejectedValue(new Error("provider down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <DashboardProvider
        deadlines={deadlines}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompleted={onTaskCompleted}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    // The intent fired (optimistic) but the completion was rejected, so the row
    // must return to its pre-click state: _completing cleared, not complete.
    expect(onTaskCompletionIntent).toHaveBeenCalledWith("todo-fails");
    const revertedDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(revertedDeadlines.upcoming[0]).toMatchObject({
      id: "todo-fails",
      status: "incomplete",
    });
    expect(revertedDeadlines.upcoming[0]._completing).toBeUndefined();
    expect(onTaskCompleted).not.toHaveBeenCalled();

    // The 600ms removeCompletedTask timer must never have been scheduled, so
    // advancing time cannot flip the row to complete.
    const callsBeforeAdvance = setCalendarDeadlines.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(setCalendarDeadlines.mock.calls.length).toBe(callsBeforeAdvance);
    expect(onTaskCompleted).not.toHaveBeenCalled();
    const finalDeadlines = setCalendarDeadlines.mock.results[setCalendarDeadlines.mock.results.length - 1]!.value;
    expect(finalDeadlines.upcoming[0].status).toBe("incomplete");

    errorSpy.mockRestore();
  });

  it("ignores Complete on a task that is already _completing", async () => {
    const task = {
      id: "todo-inflight",
      title: "Already completing",
      due_date: "2026-04-21",
      status: "incomplete",
      _completing: true,
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompletionIntent = vi.fn();

    render(
      <DashboardProvider
        deadlines={deadlines}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).not.toHaveBeenCalled();
    expect(onTaskCompletionIntent).not.toHaveBeenCalled();
    expect(setCalendarDeadlines).not.toHaveBeenCalled();
  });

  it("ignores Complete on a task whose status is already complete", async () => {
    const task = {
      id: "todo-done",
      title: "Already complete",
      due_date: "2026-04-21",
      status: "complete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompletionIntent = vi.fn();

    render(
      <DashboardProvider
        deadlines={deadlines}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).not.toHaveBeenCalled();
    expect(onTaskCompletionIntent).not.toHaveBeenCalled();
    expect(setCalendarDeadlines).not.toHaveBeenCalled();
  });

  it("ignores Complete on a deadline with no due_date (the occurrence completer needs a date)", async () => {
    // completeDeadlineOccurrence keys on (id, due_date); a deadline without one
    // cannot be completed, so the guard must bail before firing the intent (the
    // sound) or hitting the server — never half-fire on an uncompletable row.
    const task = {
      id: "todo-undated",
      title: "No due date",
      due_date: null,
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const onTaskCompletionIntent = vi.fn();

    render(
      <DashboardProvider
        deadlines={deadlines}
        setCalendarDeadlines={setCalendarDeadlines}
        onTaskCompletionIntent={onTaskCompletionIntent}
      >
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).not.toHaveBeenCalled();
    expect(onTaskCompletionIntent).not.toHaveBeenCalled();
    expect(setCalendarDeadlines).not.toHaveBeenCalled();
  });

  it("seeds the empty store from the current deadlines view so optimistic flags are kept", async () => {
    const task = {
      id: "todo-fallback",
      title: "Fallback task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    // The cache has not loaded yet: its updater receives undefined.
    const setCalendarDeadlines = vi.fn((updater) => updater(undefined));

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    const seededDeadlines = setCalendarDeadlines.mock.results[0]!.value;
    expect(seededDeadlines.upcoming[0]).toMatchObject({
      id: "todo-fallback",
      _completing: true,
    });
  });
});
