import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePlanningReadinessState from "./usePlanningReadinessState.js";

// IMPORTANT: build props ONCE per test. The ensure effect depends on the
// ensureRange function identities, so a fresh props object per render would
// re-trigger the effect every render → infinite loop. The real controller
// passes stable references, which this mirrors.
function planningProps(overrides = {}) {
  return {
    open: true,
    view: "events",
    viewYear: 2026,
    viewMonth: 3,
    eventsEnsureRange: vi.fn().mockResolvedValue([]),
    eventsRevision: 0,
    eventEditorIsEditorOpen: false,
    onEventsVisibleRangeChange: undefined,
    deadlineOverlayVisible: true,
    deadlinesEnsureRange: vi.fn().mockResolvedValue({ upcoming: [] }),
    ...overrides,
  };
}

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("usePlanningReadinessState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays idle while the modal is closed", () => {
    const props = planningProps({ open: false });
    const { result } = renderHook(() => usePlanningReadinessState(props));
    expect(result.current.planningReadiness.state).toBe("idle");
  });

  it("resolves to ready when the deadline overlay is disabled", async () => {
    const props = planningProps({ deadlineOverlayVisible: false });
    const { result } = renderHook(() => usePlanningReadinessState(props));
    await advance(0);
    expect(result.current.planningReadiness.state).toBe("ready");
  });

  it("escalates loading → slow → degraded while deadlines stall", async () => {
    let resolveDeadlines;
    const props = planningProps({
      eventsEnsureRange: vi.fn().mockResolvedValue([]),
      deadlinesEnsureRange: vi.fn(() => new Promise((resolve) => { resolveDeadlines = resolve; })),
    });
    const { result } = renderHook(() => usePlanningReadinessState(props));

    await advance(0);

    await advance(2000);
    expect(result.current.planningReadiness.state).toBe("slow");
    expect(result.current.planningReadiness.slowSource).toBe("deadlines");

    await advance(1000);
    expect(result.current.planningReadiness.state).toBe("degraded");
    expect(result.current.planningReadiness.deadlinesDelayed).toBe(true);

    // Late deadlines arrive after degrade: stashed for an explicit apply, not committed.
    await act(async () => { resolveDeadlines({ upcoming: [] }); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.lateDeadlineOverlayData).not.toBeNull();
  });

  it("commits the deadline overlay payload when both sources resolve in time", async () => {
    const deadlineData = { upcoming: [{ id: "t1", due_date: "2026-04-20", status: "open" }] };
    const props = planningProps({
      eventsEnsureRange: vi.fn().mockResolvedValue([]),
      deadlinesEnsureRange: vi.fn().mockResolvedValue(deadlineData),
    });
    const { result } = renderHook(() => usePlanningReadinessState(props));

    await advance(0);

    expect(result.current.planningReadiness.state).toBe("ready");
    expect(result.current.committedDeadlineOverlayData).toMatchObject({ data: deadlineData });
    expect(result.current.lateDeadlineOverlayData).toBeNull();
  });

  it("defers the ensure pass while the event editor is open", async () => {
    const props = planningProps({
      eventsEnsureRange: vi.fn().mockResolvedValue([]),
      eventEditorIsEditorOpen: true,
    });
    renderHook(() => usePlanningReadinessState(props));

    expect(props.eventsEnsureRange).not.toHaveBeenCalled();
    await advance(260);
    expect(props.eventsEnsureRange).toHaveBeenCalledTimes(1);
  });
});
