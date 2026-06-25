import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NeedsYouBand from "./NeedsYouBand.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); });

vi.mock("../../shared/StatusChip", () => ({
  StatusChip: ({ label }) => <span data-testid="chip">{label}</span>,
}));
vi.mock("../../shared/StatusDot", () => ({
  StatusDot: () => <span data-testid="dot" />,
}));

const snapshotLanes = {
  needs_attention: [{ id: 1, snapshot_item_id: 1, uid: "u1", lane: "needs_attention", from: "Riley Park", subject: "PR blocker", read: false, urgency: "high" }],
  fyi: [], carryover: [],
};

describe("NeedsYouBand", () => {
  it("shows a centered 'All clear' when nothing needs attention — no 'Needs you now' label, no count", () => {
    render(<NeedsYouBand snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }} liveDeadlines={{ upcoming: [] }} liveBills={[]} />);
    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.queryByText("Needs you now")).toBeNull();
    expect(screen.queryByText(/items want/)).toBeNull();
  });

  it("still surfaces upcoming items in the band when all clear", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [{ id: "up1", title: "Submit report", due_date: "2026-06-22", status: "open", class_name: "Work" }] }}
        liveBills={[]}
      />,
    );
    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.getByText("Submit report")).toBeTruthy();
  });

  it("marks an upcoming deadline done from the band (quiet action); bills get none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    const onCompleteDeadline = vi.fn();
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [{ id: "up1", title: "Submit report", due_date: "2026-06-22", status: "open", class_name: "Work" }] }}
        liveBills={[{ id: "rent", name: "Rent", payee: "LL", amount: 1800, next_date: "2026-06-23", paid: false }]}
        onCompleteDeadline={onCompleteDeadline}
      />,
    );
    // The upcoming deadline card exposes exactly one quiet Mark done; the bill card has none.
    const markDone = screen.getByText("Mark done");
    fireEvent.click(markDone);
    expect(onCompleteDeadline).toHaveBeenCalledWith("up1", expect.objectContaining({ id: "up1" }));
    expect(screen.queryByText("Submit report")).toBeNull();
    expect(screen.getByText("Rent")).toBeTruthy();
  });

  it("renders a card per urgent item and the count", () => {
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} />);
    expect(screen.getByText("PR blocker")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("clicking the email card opens the reader (onOpenEmail) and the email STAYS — no separate Open button", () => {
    const onOpenEmail = vi.fn();
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onOpenEmail={onOpenEmail} />);
    expect(screen.queryByText("Open email")).toBeNull();
    fireEvent.click(screen.getByText("PR blocker"));
    expect(onOpenEmail).toHaveBeenCalledWith("u1");
    expect(screen.getByText("PR blocker")).toBeTruthy();
  });

  it("Mark handled calls onMarkHandled(snapshotItemId) and removes the card", () => {
    const onMarkHandled = vi.fn();
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);
    fireEvent.click(screen.getByText("Mark handled"));
    expect(onMarkHandled).toHaveBeenCalledWith(1);
    expect(screen.queryByText("PR blocker")).toBeNull();
  });

  it("clicking 'Mark done' on a deadline calls onCompleteDeadline(id, data) and removes the card", () => {
    const onCompleteDeadline = vi.fn();
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [{ id: "pr", title: "Ship the thing", due_date: "2020-01-01", status: "open", priority: 1, class_name: "Eng" }] }}
        liveBills={[]}
        onCompleteDeadline={onCompleteDeadline}
      />,
    );
    fireEvent.click(screen.getByText("Mark done"));
    expect(onCompleteDeadline).toHaveBeenCalledWith("pr", expect.objectContaining({ id: "pr" }));
    expect(screen.queryByText("Ship the thing")).toBeNull();
  });

  it("a due-today bill card has no completion button (bills aren't Todoist items)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [] }}
        liveBills={[{ id: "rent", name: "Rent", payee: "Landlord", amount: 1800, next_date: "2026-06-19", paid: false }]}
      />,
    );
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.queryByText("Mark done")).toBeNull();
    expect(screen.queryByText("Mark handled")).toBeNull();
  });

  it("renders the cards in a swipeable carousel on mobile", () => {
    render(
      <NeedsYouBand
        snapshotLanes={snapshotLanes}
        liveDeadlines={{ upcoming: [] }}
        liveBills={[]}
        isMobile
      />,
    );
    expect(screen.getByTestId("needs-you-carousel")).toBeTruthy();
    expect(screen.getByText("PR blocker")).toBeTruthy();
  });

  it("keeps the desktop row (no carousel) when not mobile", () => {
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} />);
    expect(screen.queryByTestId("needs-you-carousel")).toBeNull();
    expect(screen.getByText("PR blocker")).toBeTruthy();
  });

  it("Mark handled fires onMarkHandled through the carousel on mobile", () => {
    const onMarkHandled = vi.fn();
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} isMobile />);
    fireEvent.click(screen.getByText("Mark handled"));
    expect(onMarkHandled).toHaveBeenCalledWith(1);
  });
});
