import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import type { DashboardDeadline, DashboardDeadlineRoot } from "./dashboardTaskProjection";
import { completeDeadlineOccurrence, updateDeadline } from "../api";

// test-architecture: allow-boundary-mock -- Dashboard deadline actions cross authenticated Todoist HTTP writes; controlled success/failure responses keep the real provider and optimistic state machine integrated.
vi.mock("../api", () => ({
  completeDeadlineOccurrence: vi.fn(),
  updateDeadline: vi.fn(),
}));

const completeMock = vi.mocked(completeDeadlineOccurrence);
const updateMock = vi.mocked(updateDeadline);

function stats(incomplete: number) {
  return { incomplete, dueToday: 0, dueThisWeek: 0, totalPoints: 0 };
}

function Probe({ task, moveTarget = "2026-04-25" }: { task: DashboardDeadline; moveTarget?: string }) {
  const actions = useDashboard();
  return (
    <>
      <button type="button" onClick={() => actions.handleUpdateTask({ ...task, due_date: "2026-04-30", due_time: "4:00 PM" })}>Update latest</button>
      <button type="button" onClick={() => actions.handleCompleteTask(task.id, task)}>Complete</button>
      <button type="button" onClick={() => actions.handleMoveTask(task, moveTarget)}>Move</button>
    </>
  );
}

function DeadlineHarness({ initial, task, moveTarget }: { initial: DashboardDeadlineRoot; task: DashboardDeadline; moveTarget?: string }) {
  const [deadlines, setDeadlines] = useState(initial);
  return (
    <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setDeadlines}>
      <Probe task={task} moveTarget={moveTarget} />
      <button type="button" onClick={() => setDeadlines({ upcoming: [], stats: stats(0) })}>Drop all</button>
      <button type="button" onClick={() => setDeadlines({
        upcoming: [{ ...task, due_date: "2026-04-23", status: "incomplete", _completing: undefined }],
        stats: stats(1),
      })}>Advance recurring</button>
      <output aria-label="deadline state">{JSON.stringify(deadlines)}</output>
    </DashboardProvider>
  );
}

function readDeadlines(): DashboardDeadlineRoot {
  return JSON.parse(screen.getByRole("status", { name: "deadline state" }).textContent || "{}");
}

describe("DashboardContext deadline facade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    completeMock.mockResolvedValue({ completed: true, alreadyCompleted: false, deadlineId: "test", occurrenceDate: "2026-04-21" });
    updateMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("optimistically completes an occurrence and settles it after the UX delay", async () => {
    const task = { id: "todo-complete", title: "Complete me", due_date: "2026-04-21", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);

    await act(async () => fireEvent.click(screen.getByText("Complete")));
    expect(readDeadlines().upcoming[0]).toMatchObject({ id: "todo-complete", _completing: true });
    // test-architecture: allow-boundary-interaction -- the completed UI cannot reveal which Todoist occurrence key crossed the outbound write boundary.
    expect(completeDeadlineOccurrence).toHaveBeenCalledWith("todo-complete", "2026-04-21");

    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(readDeadlines().upcoming[0]).toMatchObject({ id: "todo-complete", status: "complete" });
    expect(readDeadlines().upcoming[0]?._completing).toBeUndefined();
  });

  it("reverts the optimistic completion when the provider rejects", async () => {
    const task = { id: "todo-fails", title: "Fails", due_date: "2026-04-21", status: "incomplete" };
    completeMock.mockRejectedValue(new Error("provider down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);

    await act(async () => fireEvent.click(screen.getByText("Complete")));
    expect(readDeadlines().upcoming[0]).toMatchObject({ id: "todo-fails", status: "incomplete" });
    expect(readDeadlines().upcoming[0]?._completing).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { id: "todo-inflight", due_date: "2026-04-21", status: "incomplete", _completing: true },
    { id: "todo-done", due_date: "2026-04-21", status: "complete" },
    { id: "todo-undated", due_date: null, status: "incomplete" },
  ])("does not write an ineligible occurrence for $id", async (task) => {
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Complete")));
    // test-architecture: allow-boundary-interaction -- unchanged local state cannot prove an ineligible occurrence avoided the irreversible outbound Todoist completion write.
    expect(completeDeadlineOccurrence).not.toHaveBeenCalled();
  });

  it("uses the latest deadline occurrence at call time", async () => {
    const task = { id: "todo-latest", title: "Latest", due_date: "2026-04-01", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    fireEvent.click(screen.getByText("Update latest"));
    await act(async () => fireEvent.click(screen.getByText("Complete")));
    // test-architecture: allow-boundary-interaction -- the exact live occurrence date is an outbound provider-compatibility key not recoverable from the later completed rendering.
    expect(completeDeadlineOccurrence).toHaveBeenCalledWith("todo-latest", "2026-04-30");
  });

  it("does not resurrect a task removed by a refetch before the completion timer fires", async () => {
    const task = { id: "todo-refetched-away", title: "Gone", due_date: "2026-04-21", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Complete")));
    fireEvent.click(screen.getByText("Drop all"));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(readDeadlines().upcoming).toEqual([]);
  });

  it("does not complete the next recurring occurrence when a refetch advances the shared id before the timer fires", async () => {
    const task = { id: "todo-recurring", title: "Check-in (IHSS)", due_date: "2026-04-21", status: "incomplete", is_recurring: true };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Complete")));

    fireEvent.click(screen.getByText("Advance recurring"));
    await act(async () => vi.advanceTimersByTimeAsync(600));

    expect(readDeadlines().upcoming[0]).toMatchObject({
      id: "todo-recurring",
      due_date: "2026-04-23",
      status: "incomplete",
    });
  });

  it("cancels the completion timer when the provider unmounts", async () => {
    const task = { id: "todo-unmount", title: "Unmount", due_date: "2026-04-21", status: "incomplete" };
    const view = render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Complete")));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves a deadline optimistically and preserves its time in the outbound write", async () => {
    const task = { id: "todo-move", title: "Timed", due_date: "2026-04-21", due_time: "3:00 PM", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Move")));
    expect(readDeadlines().upcoming[0]?.due_date).toBe("2026-04-25");
    // test-architecture: allow-boundary-interaction -- the rendered target day does not expose the preserved due time sent to the outbound Todoist write.
    expect(updateDeadline).toHaveBeenCalledWith("todo-move", { dueDate: "2026-04-25", dueTime: "3:00 PM" });
  });

  it("rolls an optimistic move back when the provider rejects", async () => {
    const task = { id: "todo-move-fails", title: "Timed", due_date: "2026-04-21", due_time: "3:00 PM", status: "incomplete" };
    updateMock.mockRejectedValue(new Error("provider down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Move")));
    expect(readDeadlines().upcoming[0]?.due_date).toBe("2026-04-21");
  });

  it("does not issue a same-day move", async () => {
    const task = { id: "todo-noop", title: "Same day", due_date: "2026-04-21", due_time: "3:00 PM", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} moveTarget="2026-04-21" />);
    await act(async () => fireEvent.click(screen.getByText("Move")));
    // test-architecture: allow-boundary-interaction -- unchanged local state cannot prove a same-day drag avoided an unnecessary outbound provider write.
    expect(updateDeadline).not.toHaveBeenCalled();
  });

  it("uses live cache time for a move started from a stale drag snapshot", async () => {
    const task = { id: "todo-stale-time", title: "Timed", due_date: "2026-04-21", due_time: "3:00 PM", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [task], stats: stats(1) }} task={task} />);
    fireEvent.click(screen.getByText("Update latest"));
    await act(async () => fireEvent.click(screen.getByText("Move")));
    // test-architecture: allow-boundary-interaction -- the exact live time is provider payload compatibility data and is not visible after the day-only move.
    expect(updateDeadline).toHaveBeenCalledWith("todo-stale-time", { dueDate: "2026-04-25", dueTime: "4:00 PM" });
  });

  it("lands a full titled chip when the target cache did not contain the task", async () => {
    const task = { id: "todo-cross", title: "Pay rent", due_date: "2026-04-21", due_time: "3:00 PM", status: "incomplete" };
    render(<DeadlineHarness initial={{ upcoming: [], stats: stats(0) }} task={task} />);
    await act(async () => fireEvent.click(screen.getByText("Move")));
    expect(readDeadlines().upcoming[0]).toMatchObject({ id: "todo-cross", title: "Pay rent", due_date: "2026-04-25" });
  });
});
