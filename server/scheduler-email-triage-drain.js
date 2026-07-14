const MAX_TIMEOUT_MS = 2_147_483_647;

let requestDrainAt = () => false;

export function registerEmailTriageDrainRequester(requester) {
  requestDrainAt = typeof requester === "function" ? requester : () => false;
}

export function requestEmailTriageDrainAt(scheduledFor) {
  return requestDrainAt(scheduledFor);
}

export function createEmailTriageDeadlineController({
  scheduleTimeout,
  cancelTimeout,
  onDeadline,
  now = () => Date.now(),
}) {
  let timer = null;
  let deadlineAt = null;

  const stop = () => {
    if (timer !== null) cancelTimeout(timer);
    timer = null;
    deadlineAt = null;
  };

  const request = (scheduledFor) => {
    const requestedAt = scheduledFor instanceof Date
      ? scheduledFor.getTime()
      : Date.parse(String(scheduledFor || ""));
    if (!Number.isFinite(requestedAt)) return false;
    if (deadlineAt !== null && deadlineAt <= requestedAt) return false;

    stop();
    deadlineAt = requestedAt;
    const delayMs = Math.min(Math.max(0, requestedAt - now()), MAX_TIMEOUT_MS);
    timer = scheduleTimeout(() => {
      const firedDeadline = deadlineAt;
      timer = null;
      deadlineAt = null;
      if (firedDeadline !== null && firedDeadline > now()) {
        request(firedDeadline);
        return;
      }
      onDeadline(firedDeadline);
    }, delayMs);
    if (timer === null) deadlineAt = null;
    return timer !== null;
  };

  return { request, stop };
}
