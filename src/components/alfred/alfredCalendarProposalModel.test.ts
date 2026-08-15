import { describe, expect, it, vi } from "vitest";
import {
  alfredCreatedEventCalendarRequest,
  alfredProposalCalendarRequest,
  alfredProposalCalendarSeed,
  calendarEventDiffersFromProposal,
} from "./alfredCalendarProposalModel";
import type { AlfredCalendarProposal } from "../../../shared/types/alfred";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";

const proposal: AlfredCalendarProposal = {
  id: "proposal-1",
  revisionOf: null,
  title: "Project review",
  allDay: false,
  startDate: "2026-08-18",
  endDate: "2026-08-18",
  startTime: "15:00",
  endTime: "15:30",
  location: "Room 1",
  description: "Bring the launch notes.",
  source: { kind: "resolved", accountId: "account-1", calendarId: "primary", calendarName: "Personal" },
  duplicateCheckUnavailable: false,
  past: false,
};

const savedEvent = {
  id: "event-1",
  title: "Project review",
  allDay: false,
  startMs: new Date("2026-08-18T22:00:00.000Z").getTime(),
  endMs: new Date("2026-08-18T22:30:00.000Z").getTime(),
  location: "Room 1",
  description: "Bring the launch notes.",
  accountId: "account-1",
  calendarId: "primary",
  calendarName: "Personal",
} as NormalizedCalendarEvent;

describe("Alfred calendar proposal bridge adapter", () => {
  it("maps only structured proposal fields into the accepted Calendar seed", () => {
    expect(alfredProposalCalendarSeed(proposal)).toEqual({
      title: "Project review",
      allDay: false,
      startDate: "2026-08-18",
      endDate: "2026-08-18",
      startTime: "15:00",
      endTime: "15:30",
      location: "Room 1",
      description: "Bring the launch notes.",
      source: { kind: "resolved", accountId: "account-1", calendarId: "primary" },
    });
  });

  it("creates a zero-write review request with opaque origin and existing callbacks", () => {
    const onAcknowledged = vi.fn();
    const onCompleted = vi.fn();
    const request = alfredProposalCalendarRequest(proposal, { onAcknowledged, onCompleted });

    expect(request).toMatchObject({
      viewKey: "events",
      focusDate: "2026-08-18",
      focusItemId: "new",
      options: {
        eventCreateRequest: {
          origin: { kind: "alfred-proposal", referenceId: "proposal-1" },
        },
      },
    });
    expect(request.options.eventCreateRequest?.onAcknowledged).toBe(onAcknowledged);
    expect(request.options.eventCreateRequest?.onCompleted).toBe(onCompleted);
    expect(JSON.stringify(request)).not.toContain("createCalendarEvent");
  });

  it("opens the normalized created event and detects editor changes", () => {
    expect(alfredCreatedEventCalendarRequest(savedEvent)).toMatchObject({
      viewKey: "events",
      focusDate: "2026-08-18",
      focusItemId: "event-1",
      options: { openDetail: true },
    });
    expect(calendarEventDiffersFromProposal(proposal, savedEvent)).toBe(false);
    expect(calendarEventDiffersFromProposal(proposal, { ...savedEvent, title: "Edited" })).toBe(true);
  });
});
