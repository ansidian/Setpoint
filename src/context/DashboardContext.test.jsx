import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext.jsx";
import { completeDeadlineOccurrence, updateDeadline } from "../api";

vi.mock("../api", () => ({
  completeDeadlineOccurrence: vi.fn(),
  updateDeadline: vi.fn(),
}));

function Probe({ task, moveTarget = "2026-04-25" }) {
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
    const deadlines = { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    fireEvent.click(screen.getByText("Add"));

    expect(setCalendarDeadlines).toHaveBeenCalled();
    const nextDeadlines = setCalendarDeadlines.mock.results[0].value;
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
    const updatedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
    expect(updatedDeadlines.upcoming[0].title).toBe("Updated title");

    fireEvent.click(screen.getByText("Delete"));
    const remainingDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
    expect(remainingDeadlines.upcoming).toEqual([]);
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
    completeDeadlineOccurrence.mockRejectedValue(new Error("provider down"));
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
    const revertedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
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
    const finalDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
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

    const seededDeadlines = setCalendarDeadlines.mock.results[0].value;
    expect(seededDeadlines.upcoming[0]).toMatchObject({
      id: "todo-fallback",
      _completing: true,
    });
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
    updateDeadline.mockResolvedValue({});

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
    const movedDeadlines = setCalendarDeadlines.mock.results[0].value;
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
    updateDeadline.mockRejectedValue(new Error("provider down"));
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
    const revertedDeadlines = setCalendarDeadlines.mock.results.at(-1).value;
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
    updateDeadline.mockResolvedValue({});

    render(
      <DashboardProvider deadlines={targetMonthCache} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} moveTarget="2026-04-25" />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    const moved = setCalendarDeadlines.mock.results[0].value;
    expect(moved.upcoming[0]).toMatchObject({
      id: "todo-cross",
      due_date: "2026-04-25",
      title: "Pay rent",
    });
  });
});
