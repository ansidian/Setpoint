import type {
  AlfredCalendarProposal,
} from "../../../shared/types/alfred";
import type {
  CalendarEventCreateAcknowledgement,
  CalendarEventCreateCompletion,
  CalendarEventCreateSeed,
  NormalizedCalendarEvent,
} from "../../../shared/types/calendar";
import type { CalendarEventCreateRequest } from "../../hooks/calendar/calendarEventCreateBridge";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";

function pacificDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function pacificTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function alfredProposalCalendarSeed(proposal: AlfredCalendarProposal): CalendarEventCreateSeed {
  return {
    title: proposal.title,
    allDay: proposal.allDay,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    startTime: proposal.startTime,
    endTime: proposal.endTime,
    location: proposal.location || null,
    description: proposal.description || null,
    ...(proposal.source.kind === "resolved"
      ? {
          source: {
            kind: "resolved" as const,
            accountId: proposal.source.accountId,
            calendarId: proposal.source.calendarId,
          },
        }
      : proposal.source.requestedCalendarName
        ? {
            source: {
              kind: "requested" as const,
              calendarName: proposal.source.requestedCalendarName,
            },
          }
        : {}),
  };
}

export function alfredProposalCalendarRequest(
  proposal: AlfredCalendarProposal,
  callbacks: {
    onAcknowledged: (acknowledgement: CalendarEventCreateAcknowledgement) => void;
    onCompleted: (completion: CalendarEventCreateCompletion) => void;
  },
): CalendarOpenRequest {
  const eventCreateRequest: CalendarEventCreateRequest = {
    seed: alfredProposalCalendarSeed(proposal),
    origin: { kind: "alfred-proposal", referenceId: proposal.id },
    onAcknowledged: callbacks.onAcknowledged,
    onCompleted: callbacks.onCompleted,
  };
  return {
    viewKey: "events",
    focusDate: proposal.startDate,
    focusItemId: "new",
    options: {
      source: "alfred-proposal",
      eventCreateRequest,
    },
  };
}

export function alfredCreatedEventCalendarRequest(event: NormalizedCalendarEvent): CalendarOpenRequest {
  return {
    viewKey: "events",
    focusDate: pacificDate(event.startMs),
    focusItemId: event.id,
    options: {
      source: "alfred-proposal-created",
      openDetail: true,
      forceEventOverlay: true,
    },
  };
}

export function calendarEventDiffersFromProposal(
  proposal: AlfredCalendarProposal,
  event: NormalizedCalendarEvent,
): boolean {
  if (proposal.title !== event.title) return true;
  if (proposal.location !== (event.location || "")) return true;
  if (proposal.description !== (event.description || "")) return true;
  if (proposal.allDay !== event.allDay) return true;
  if (proposal.source.kind === "resolved"
    && (proposal.source.accountId !== event.accountId || proposal.source.calendarId !== event.calendarId)) return true;
  if (proposal.startDate !== pacificDate(event.startMs)) return true;
  if (proposal.allDay) {
    return proposal.endDate !== pacificDate(Math.max(event.startMs, event.endMs - 1));
  }
  return proposal.startTime !== pacificTime(event.startMs)
    || proposal.endDate !== pacificDate(event.endMs)
    || proposal.endTime !== pacificTime(event.endMs);
}

export function createdEventSchedule(event: NormalizedCalendarEvent): {
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
} {
  return event.allDay
    ? {
        startDate: pacificDate(event.startMs),
        endDate: pacificDate(Math.max(event.startMs, event.endMs - 1)),
        startTime: null,
        endTime: null,
      }
    : {
        startDate: pacificDate(event.startMs),
        endDate: pacificDate(event.endMs),
        startTime: pacificTime(event.startMs),
        endTime: pacificTime(event.endMs),
      };
}
