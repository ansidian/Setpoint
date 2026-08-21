import {
  createDeadlineController,
  type DrainRequester,
  type ScheduledFor,
} from "./scheduler-deadline-controller.ts";

export type EmailTriageScheduledFor = ScheduledFor;
export type EmailTriageDrainRequester = DrainRequester;

let requestDrainAt: EmailTriageDrainRequester = () => false;

export function registerEmailTriageDrainRequester(requester: EmailTriageDrainRequester): void {
  requestDrainAt = typeof requester === "function" ? requester : () => false;
}

export function requestEmailTriageDrainAt(scheduledFor: EmailTriageScheduledFor): boolean {
  return requestDrainAt(scheduledFor);
}

export { createDeadlineController as createEmailTriageDeadlineController };
