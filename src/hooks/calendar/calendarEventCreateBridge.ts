import type {
  CalendarEventCreateAcknowledgement,
  CalendarEventCreateCompletion,
  CalendarEventCreateOrigin,
  CalendarEventCreateSeed,
} from "../../../shared/types/calendar";

export interface CalendarEventCreateRequest {
  seed: CalendarEventCreateSeed;
  origin: CalendarEventCreateOrigin;
  onAcknowledged?: (acknowledgement: CalendarEventCreateAcknowledgement) => void;
  onCompleted?: (completion: CalendarEventCreateCompletion) => void;
}

export type CalendarEventCreateOpenResult =
  | { accepted: true }
  | {
      accepted: false;
      reason: Extract<CalendarEventCreateAcknowledgement, { status: "failed" }>["reason"];
    };

export function acknowledgeCalendarEventCreateRequest(
  request: CalendarEventCreateRequest,
  result: CalendarEventCreateOpenResult,
) {
  try {
    request.onAcknowledged?.(result.accepted
      ? { status: "accepted", origin: request.origin }
      : { status: "failed", origin: request.origin, reason: result.reason });
  } catch {
    // Coordination callbacks must never change Calendar editor behavior.
  }
}

export function completeCalendarEventCreateRequest(
  request: CalendarEventCreateRequest,
  completion: CalendarEventCreateCompletion,
) {
  try {
    request.onCompleted?.(completion);
  } catch {
    // A caller failure cannot turn a completed provider write into a save error.
  }
}
