const MAX_TIMEOUT_MS = 2_147_483_647;

export type ScheduledFor = Date | string | number;
export type DrainRequester = (scheduledFor: ScheduledFor) => boolean;

interface DeadlineControllerOptions<THandle> {
  scheduleTimeout: (task: () => void, delayMs: number) => THandle | null;
  cancelTimeout: (handle: THandle) => void;
  onDeadline: (deadlineAt: number | null) => void;
  now?: () => number;
}

export function createDeadlineController<THandle>({
  scheduleTimeout,
  cancelTimeout,
  onDeadline,
  now = () => Date.now(),
}: DeadlineControllerOptions<THandle>) {
  let timer: THandle | null = null;
  let deadlineAt: number | null = null;

  const stop = (): void => {
    if (timer !== null) cancelTimeout(timer);
    timer = null;
    deadlineAt = null;
  };

  const request: DrainRequester = (scheduledFor) => {
    const requestedAt = scheduledFor instanceof Date
      ? scheduledFor.getTime()
      : typeof scheduledFor === "number"
        ? scheduledFor
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
