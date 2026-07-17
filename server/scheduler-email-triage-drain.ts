const MAX_TIMEOUT_MS = 2_147_483_647;

export type EmailTriageScheduledFor = Date | string | number;
export type EmailTriageDrainRequester = (scheduledFor: EmailTriageScheduledFor) => boolean;

let requestDrainAt: EmailTriageDrainRequester = () => false;

export function registerEmailTriageDrainRequester(requester: EmailTriageDrainRequester): void {
  requestDrainAt = typeof requester === "function" ? requester : () => false;
}

export function requestEmailTriageDrainAt(scheduledFor: EmailTriageScheduledFor): boolean {
  return requestDrainAt(scheduledFor);
}

interface EmailTriageDeadlineControllerOptions<THandle> {
  scheduleTimeout: (task: () => void, delayMs: number) => THandle | null;
  cancelTimeout: (handle: THandle) => void;
  onDeadline: (deadlineAt: number | null) => void;
  now?: () => number;
}

export function createEmailTriageDeadlineController<THandle>({
  scheduleTimeout,
  cancelTimeout,
  onDeadline,
  now = () => Date.now(),
}: EmailTriageDeadlineControllerOptions<THandle>) {
  let timer: THandle | null = null;
  let deadlineAt: number | null = null;

  const stop = (): void => {
    if (timer !== null) cancelTimeout(timer);
    timer = null;
    deadlineAt = null;
  };

  const request: EmailTriageDrainRequester = (scheduledFor) => {
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
