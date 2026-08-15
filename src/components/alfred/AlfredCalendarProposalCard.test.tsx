import { useState } from "react";
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
  it("renders the full non-color proposal state and keeps disclosure before review in tab order", () => {
    render(
      <AlfredCalendarProposalCard
        proposal={proposal}
        status="proposed"
        handoffError={null}
        createdEvent={null}
        editedInCalendar={false}
        accent="#cba6da"
        onReview={vi.fn().mockResolvedValue(false)}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.getByText("Proposed event")).toBeTruthy();
    expect(screen.getByText("Past date")).toBeTruthy();
    expect(screen.getByText("Duplicate check unavailable")).toBeTruthy();
    expect(screen.getByText("Calendar unavailable (requested: Work)")).toBeTruthy();
    expect(screen.getByText(/Aug 18, 2026 · 3:00 PM–3:30 PM/)).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["View details", "Review in Calendar"]);
    fireEvent.click(buttons[0]!);
    expect(screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-expanded")).toBe("true");
  });

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

  it("renders normalized Created truth, edit disclosure, and Open event", () => {
    function Harness() {
      const [opened, setOpened] = useState(false);
      return <>
        <AlfredCalendarProposalCard
          proposal={proposal}
          status="created"
          handoffError={null}
          createdEvent={savedEvent}
          editedInCalendar
          accent="#cba6da"
          onReview={vi.fn().mockResolvedValue(true)}
          onOpenEvent={() => setOpened(true)}
        />
        <output>{opened ? "event opened" : "event closed"}</output>
      </>;
    }
    render(<Harness />);

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Edited in Calendar")).toBeTruthy();
    expect(screen.getByText("Edited project review")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.queryByText("Project review")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open event" }));
    expect(screen.getByText("event opened")).toBeTruthy();
  });

  it("shows recoverable handoff copy and Try again", () => {
    render(
      <AlfredCalendarProposalCard
        proposal={proposal}
        status="proposed"
        handoffError="Calendar could not open this proposal. Try again."
        createdEvent={null}
        editedInCalendar={false}
        accent="#cba6da"
        onReview={vi.fn().mockResolvedValue(false)}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Calendar could not open");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
