import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import type { DashboardContextValue } from "./DashboardContext";
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

  it("keeps the context value referentially stable across a deadlines identity change with the same content", () => {
    const task = {
      id: "todo-stable",
      title: "Stable task",
      due_date: "2026-04-21",
      status: "incomplete",
    };
    const deadlines1 = { upcoming: [task], stats: { incomplete: 1, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
    const setCalendarDeadlines = vi.fn();
    const capturedValues: DashboardContextValue[] = [];

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
