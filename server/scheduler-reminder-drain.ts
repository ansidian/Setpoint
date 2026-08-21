import {
  createDeadlineController,
  type DrainRequester,
  type ScheduledFor,
} from "./scheduler-deadline-controller.ts";

export type ReminderScheduledFor = ScheduledFor;
export type ReminderDrainRequester = DrainRequester;

let requestDrainAt: ReminderDrainRequester = () => false;

export function registerReminderDrainRequester(requester: ReminderDrainRequester): void {
  requestDrainAt = typeof requester === "function" ? requester : () => false;
}

export function requestReminderDrainAt(scheduledFor: ReminderScheduledFor): boolean {
  return requestDrainAt(scheduledFor);
}

export { createDeadlineController as createReminderDeadlineController };
