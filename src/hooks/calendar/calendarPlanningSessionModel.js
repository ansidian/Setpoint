export function planningIdleState() {
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
}) {
  return {
    state: deadlineOverlayVisible ? "loading" : "ready",
    slowSource: null,
    deadlinesDelayed: false,
    lateDeadlinesReady: false,
    eventsReadyAt: null,
    deadlinesReadyAt: deadlinesDone ? startedAt : null,
  };
}

export function planningSlowState(current, {
  eventsDone,
  deadlinesDone,
}) {
  return {
    ...current,
    state: "slow",
    slowSource: !eventsDone ? "events" : !deadlinesDone ? "deadlines" : null,
  };
}

export function planningDeadlineTimedOutState(current) {
  return {
    ...current,
    state: "degraded",
    deadlinesDelayed: true,
    lateDeadlinesReady: false,
  };
}

export function planningEventsReadyState(current, { now }) {
  return { ...current, eventsReadyAt: now };
}

export function planningDeadlinesReadyState(current, {
  now,
  eventsDone,
  deadlinesTimedOut = false,
}) {
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

export function planningSettledState(current, {
  failed,
  deadlineOverlayVisible,
  deadlinesDone,
  eventsDone,
}) {
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

export function planningLateDeadlinesReadyState(current) {
  if (!current.deadlinesDelayed) return current;
  return { ...current, lateDeadlinesReady: true };
}
