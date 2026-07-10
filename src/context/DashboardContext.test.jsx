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
    let capturedResult;

    function ReturnProbe({ task }) {
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
    completeDeadlineOccurrence.mockResolvedValueOnce({});

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
    completeDeadlineOccurrence.mockRejectedValueOnce(new Error("provider down"));
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
    updateDeadline.mockResolvedValue({});

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

  it("keeps the context value referentially stable across a deadlines identity change with the same content", () => {
    const task = {
      id: "todo-stable",
      title: "Stable task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines1 = { upcoming: [task], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlines = vi.fn();
    const capturedValues = [];

    function ValueProbe() {
      capturedValues.push(useDashboard());
      return null;
    }

    const { rerender } = render(
      <DashboardProvider deadlines={deadlines1} setCalendarDeadlines={setCalendarDeadlines}>
        <ValueProbe />
      </DashboardProvider>,
    );

    // Same content, new object/array identity — simulates a poll refetch that
    // returns an unchanged deadlines view.
    const deadlines2 = { upcoming: [{ ...task }], stats: { ...deadlines1.stats } };
    rerender(
      <DashboardProvider deadlines={deadlines2} setCalendarDeadlines={setCalendarDeadlines}>
        <ValueProbe />
      </DashboardProvider>,
    );

    expect(capturedValues).toHaveLength(2);
    expect(capturedValues[1]).toBe(capturedValues[0]);
  });

  it("handleCompleteTask observes latest deadlines at call time, not a stale closure", async () => {
    const staleTask = { id: "todo-latest", due_date: "2026-04-01", status: "incomplete" };
    const freshTask = { id: "todo-latest", due_date: "2026-04-30", status: "incomplete" };
    const deadlines1 = { upcoming: [staleTask], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const deadlines2 = { upcoming: [freshTask], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines2));

    const { rerender } = render(
      <DashboardProvider deadlines={deadlines1} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={staleTask} />
      </DashboardProvider>,
    );

    rerender(
      <DashboardProvider deadlines={deadlines2} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={staleTask} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
    });

    expect(completeDeadlineOccurrence).toHaveBeenCalledWith("todo-latest", "2026-04-30");
  });

  it("the 600ms completion timer is a no-op once a refetch already removed the task", async () => {
    const task = {
      id: "todo-refetched-away",
      title: "Refetched-away task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));

    const { rerender } = render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
      await Promise.resolve();
    });

    // A refetch lands before the 600ms timer fires and the task is no longer
    // in the (new) deadlines view — e.g. it scrolled out of the visible range.
    const refetchedDeadlines = {
      upcoming: [],
      stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    rerender(
      <DashboardProvider deadlines={refetchedDeadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    const callsBeforeAdvance = setCalendarDeadlines.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // The timer must not have fired a mutation — the task is gone, so
    // removeCompletedTask should have bailed before touching the store.
    expect(setCalendarDeadlines.mock.calls.length).toBe(callsBeforeAdvance);
  });

  it("cancels the pending completion timer on unmount", async () => {
    const task = {
      id: "todo-unmount",
      title: "Unmount task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines = {
      upcoming: [task],
      stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 },
    };
    const setCalendarDeadlines = vi.fn((updater) => updater(deadlines));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setCalendarDeadlines}>
        <Probe task={task} />
      </DashboardProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Complete"));
      await Promise.resolve();
    });

    const callsBeforeUnmount = setCalendarDeadlines.mock.calls.length;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Unmounting must clear the pending timer: no further store mutation and
    // no "state update on an unmounted component" warning.
    expect(setCalendarDeadlines.mock.calls.length).toBe(callsBeforeUnmount);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
