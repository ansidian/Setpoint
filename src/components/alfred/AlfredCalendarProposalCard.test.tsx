import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AlfredCalendarProposalCard from "./AlfredCalendarProposalCard";
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
  description: "Bring the launch notes and the complete agenda so every remaining question can be reviewed before the meeting begins with the whole team.",
  source: { kind: "unavailable", requestedCalendarName: "Work" },
  duplicateCheckUnavailable: true,
  past: true,
};

const savedEvent = {
  id: "event-1",
  title: "Edited project review",
  allDay: false,
  startMs: new Date("2026-08-18T23:00:00.000Z").getTime(),
  endMs: new Date("2026-08-18T23:30:00.000Z").getTime(),
  location: "Room 2",
  description: "Saved provider truth",
  calendarName: "Personal",
  accountId: "account-1",
  calendarId: "primary",
} as NormalizedCalendarEvent;

afterEach(cleanup);

describe("AlfredCalendarProposalCard", () => {

  it("makes Superseded historical evidence non-actionable", () => {
    render(
      <AlfredCalendarProposalCard
        proposal={proposal}
        status="superseded"
        handoffError={null}
        createdEvent={null}
        editedInCalendar={false}
        accent="#cba6da"
        onReview={vi.fn().mockResolvedValue(true)}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Superseded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review in Calendar" })).toBeNull();
  });

  it("settles accepted Review state so cancel and Created actions remain usable", async () => {
    const onOpenEvent = vi.fn();
    const { rerender } = render(
      <AlfredCalendarProposalCard
        proposal={proposal}
        status="proposed"
        handoffError={null}
        createdEvent={null}
        editedInCalendar={false}
        accent="#cba6da"
        onReview={vi.fn().mockResolvedValue(true)}
        onOpenEvent={onOpenEvent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review in Calendar" }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Review in Calendar" }).disabled).toBe(false));

    rerender(
      <AlfredCalendarProposalCard
        proposal={proposal}
        status="created"
        handoffError={null}
        createdEvent={savedEvent}
        editedInCalendar
        accent="#cba6da"
        onReview={vi.fn().mockResolvedValue(true)}
        onOpenEvent={onOpenEvent}
      />,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open event" }).disabled).toBe(false);
  });
});
