import { describe, expect, it } from "vitest";
import {
  planningDeadlinesReadyState,
  planningDeadlineTimedOutState,
  planningEventsReadyState,
  planningIdleState,
  planningInitialState,
  planningLateDeadlinesReadyState,
  planningSettledState,
  planningSlowState,
} from "./calendarPlanningSessionModel";

describe("calendar planning session model", () => {
  it("keeps unopened planning sessions idle", () => {
    expect(planningIdleState()).toEqual({
      state: "idle",
      slowSource: null,
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
      eventsReadyAt: null,
      deadlinesReadyAt: null,
    });
  });

  it("starts readiness from overlay and source availability", () => {
    expect(planningInitialState({
      deadlineOverlayVisible: true,
      deadlinesDone: false,
      startedAt: 100,
    })).toEqual({
      state: "loading",
      slowSource: null,
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
      eventsReadyAt: null,
      deadlinesReadyAt: null,
    });

    expect(planningInitialState({
      deadlineOverlayVisible: false,
      deadlinesDone: true,
      startedAt: 100,
    })).toMatchObject({
      state: "ready",
      deadlinesReadyAt: 100,
    });
  });

  it("tracks slow, delayed, ready, and late-deadline transitions", () => {
    const loading = planningInitialState({
      deadlineOverlayVisible: true,
      deadlinesDone: false,
      startedAt: 100,
    });

    expect(planningSlowState(loading, { eventsDone: false, deadlinesDone: false })).toMatchObject({
      state: "slow",
      slowSource: "events",
    });
    expect(planningSlowState(loading, { eventsDone: true, deadlinesDone: false })).toMatchObject({
      state: "slow",
      slowSource: "deadlines",
    });
    expect(planningDeadlineTimedOutState(loading)).toMatchObject({
      state: "degraded",
      deadlinesDelayed: true,
      lateDeadlinesReady: false,
    });
    expect(planningEventsReadyState(loading, { now: 200 })).toMatchObject({
      eventsReadyAt: 200,
    });
    expect(planningDeadlinesReadyState(loading, { now: 300, eventsDone: true })).toMatchObject({
      state: "ready",
      deadlinesReadyAt: 300,
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
    });
    expect(planningLateDeadlinesReadyState({ ...loading, deadlinesDelayed: true })).toMatchObject({
      deadlinesDelayed: true,
      lateDeadlinesReady: true,
    });
  });

  it("settles failures and all-source success", () => {
    const loading = planningInitialState({
      deadlineOverlayVisible: true,
      deadlinesDone: false,
      startedAt: 100,
    });

    expect(planningSettledState(loading, { failed: true })).toMatchObject({
      state: "error",
      slowSource: null,
    });
    expect(planningSettledState(loading, {
      failed: false,
      deadlineOverlayVisible: true,
      deadlinesDone: true,
      eventsDone: true,
    })).toMatchObject({
      state: "ready",
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
    });
    expect(planningSettledState(loading, {
      failed: false,
      deadlineOverlayVisible: false,
      deadlinesDone: true,
      eventsDone: true,
    })).toBe(loading);
  });
});
