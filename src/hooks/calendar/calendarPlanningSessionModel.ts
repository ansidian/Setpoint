export type CalendarPlanningStateName = "idle" | "loading" | "slow" | "degraded" | "ready" | "error";
export type CalendarPlanningSlowSource = "events" | "deadlines" | null;

export interface CalendarPlanningSessionState {
  state: CalendarPlanningStateName;
  slowSource: CalendarPlanningSlowSource;
  deadlinesDelayed: boolean;
  lateDeadlinesReady: boolean;
  eventsReadyAt: number | null;
  deadlinesReadyAt: number | null;
}

export function planningIdleState(): CalendarPlanningSessionState {
  return {
    state: "idle",
    slowSource: null,
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
    eventsReadyAt: null,
    deadlinesReadyAt: null,
  };
}

export function planningInitialState({
  deadlineOverlayVisible,
  deadlinesDone,
  startedAt,
}: { deadlineOverlayVisible: boolean; deadlinesDone: boolean; startedAt: number }): CalendarPlanningSessionState {
  return {
    state: deadlineOverlayVisible ? "loading" : "ready",
    slowSource: null,
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
    eventsReadyAt: null,
    deadlinesReadyAt: deadlinesDone ? startedAt : null,
  };
}

export function planningSlowState(current: CalendarPlanningSessionState, {
  eventsDone,
  deadlinesDone,
}: { eventsDone: boolean; deadlinesDone: boolean }): CalendarPlanningSessionState {
  return {
    ...current,
    state: "slow",
    slowSource: !eventsDone ? "events" : !deadlinesDone ? "deadlines" : null,
  };
}

export function planningDeadlineTimedOutState(current: CalendarPlanningSessionState): CalendarPlanningSessionState {
  return {
    ...current,
    state: "degraded",
    deadlinesDelayed: true,
    lateDeadlinesReady: false,
  };
}

export function planningEventsReadyState(
  current: CalendarPlanningSessionState,
  { now }: { now: number },
): CalendarPlanningSessionState {
  return { ...current, eventsReadyAt: now };
}

export function planningDeadlinesReadyState(current: CalendarPlanningSessionState, {
  now,
  eventsDone,
  deadlinesTimedOut = false,
}: { now: number; eventsDone: boolean; deadlinesTimedOut?: boolean }): CalendarPlanningSessionState {
  if (deadlinesTimedOut) {
    return {
      ...current,
      deadlinesReadyAt: now,
      lateDeadlinesReady: true,
    };
  }
  if (!eventsDone) {
    return { ...current, deadlinesReadyAt: now };
  }
  return {
    ...current,
    state: "ready",
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
    deadlinesReadyAt: now,
  };
}

export function planningSettledState(current: CalendarPlanningSessionState, {
  failed,
  deadlineOverlayVisible,
  deadlinesDone,
  eventsDone,
}: {
  failed?: boolean;
  deadlineOverlayVisible?: boolean;
  deadlinesDone?: boolean;
  eventsDone?: boolean;
}): CalendarPlanningSessionState {
  if (failed) {
    return {
      ...current,
      state: "error",
      slowSource: null,
    };
  }
  if (!deadlineOverlayVisible) return current;
  if (!deadlinesDone || !eventsDone) return current;
  return {
    ...current,
    state: "ready",
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
  };
}

export function planningLateDeadlinesReadyState(current: CalendarPlanningSessionState): CalendarPlanningSessionState {
  if (!current.deadlinesDelayed) return current;
  return { ...current, lateDeadlinesReady: true };
}
