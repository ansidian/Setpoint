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
});
