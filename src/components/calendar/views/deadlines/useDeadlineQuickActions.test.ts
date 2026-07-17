import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  deleteDeadline: vi.fn(),
}));

const { default: useDeadlineQuickActions } = await import("./useDeadlineQuickActions");

function makeProps() {
  return {
    enabled: true,
    layout: { stacked: false },
    actions: {
      onCompleteTask: vi.fn(),
      onDeleteTask: vi.fn(),
      onMoveTask: vi.fn(),
    },
    onEditTask: vi.fn(),
    onDeleted: vi.fn(),
  };
}

describe("useDeadlineQuickActions identity stability", () => {
  it("returns the same actions object when the parent re-renders with fresh callback props", () => {
    const { result, rerender } = renderHook((props) => useDeadlineQuickActions(props), {
      initialProps: makeProps(),
    });
    const first = result.current;

    rerender(makeProps());

    expect(result.current).toBe(first);
  });
});

describe("useDeadlineQuickActions drag-reschedule slice", () => {
  const timedTask = {
    id: "t1",
    due_date: "2026-06-22",
    due_time: "3:00 PM",
    is_recurring: false,
    status: "needs_action",
  };

  it("disables drag on a stacked (mobile) layout", () => {
    const { result } = renderHook(() => useDeadlineQuickActions({ ...makeProps(), layout: { stacked: true } }));
    expect(result.current.dragEnabled).toBe(false);
  });

  it("enables drag on a desktop layout and tracks the dragging deadline", () => {
    const { result } = renderHook(() => useDeadlineQuickActions(makeProps()));
    expect(result.current.dragEnabled).toBe(true);

    let started;
    act(() => { started = result.current.beginDrag(timedTask); });
    expect(started).toBe(true);
    expect(result.current.draggingDeadlineId).toBe("t1");

    act(() => { result.current.endDrag(); });
    expect(result.current.draggingDeadlineId).toBeNull();
  });

  it("refuses to drag a recurring or completed deadline", () => {
    const { result } = renderHook(() => useDeadlineQuickActions(makeProps()));

    let recurringStarted;
    let completeStarted;
    act(() => { recurringStarted = result.current.beginDrag({ ...timedTask, is_recurring: true }); });
    act(() => { completeStarted = result.current.beginDrag({ ...timedTask, status: "complete" }); });

    expect(recurringStarted).toBe(false);
    expect(completeStarted).toBe(false);
    expect(result.current.draggingDeadlineId).toBeNull();
  });

  it("routes a cross-day drop through onMoveTask", () => {
    const props = makeProps();
    const { result } = renderHook(() => useDeadlineQuickActions(props));

    act(() => { result.current.dropDeadline({ deadline: timedTask, targetDate: "2026-06-25" }); });

    expect(props.actions.onMoveTask).toHaveBeenCalledWith(timedTask, "2026-06-25");
  });

  it("no-ops a same-day drop (no move call)", () => {
    const props = makeProps();
    const { result } = renderHook(() => useDeadlineQuickActions(props));

    act(() => { result.current.dropDeadline({ deadline: timedTask, targetDate: "2026-06-22" }); });

    expect(props.actions.onMoveTask).not.toHaveBeenCalled();
  });
});
