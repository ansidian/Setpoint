import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
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

  it("opens an upcoming deadline's detail from the card body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    const onOpen = vi.fn();
    const deadline = { id: "up1", title: "Submit report", due_date: "2026-06-22", status: "open", class_name: "Work" };
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [deadline] }}
        liveBills={[]}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByText("Submit report"));

    expect(onOpen).toHaveBeenCalledWith(
      { kind: "deadline", id: "up1", date: "2026-06-22", data: deadline },
      expect.any(HTMLElement),
    );
  });

  it("opens an upcoming bill's detail from the card body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    const onOpen = vi.fn();
    const bill = { id: "rent", name: "Rent", payee: "Landlord", amount: 1800, next_date: "2026-06-23", paid: false };
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [] }}
        liveBills={[bill]}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByText("Rent"));

    expect(onOpen).toHaveBeenCalledWith(
      { kind: "bill", id: "rent", date: "2026-06-23", data: bill },
      expect.any(HTMLElement),
    );
  });

  it("marks an upcoming deadline done from the band (quiet action); bills get none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    const onCompleteDeadline = vi.fn();
    const onOpen = vi.fn();
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [{ id: "up1", title: "Submit report", due_date: "2026-06-22", status: "open", class_name: "Work" }] }}
        liveBills={[{ id: "rent", name: "Rent", payee: "LL", amount: 1800, next_date: "2026-06-23", paid: false }]}
        onCompleteDeadline={onCompleteDeadline}
        onOpen={onOpen}
      />,
    );
    // The upcoming deadline card exposes exactly one quiet Mark done; the bill card has none.
    const markDone = screen.getByText("Mark done");
    fireEvent.keyDown(markDone, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(markDone);
    expect(onCompleteDeadline).toHaveBeenCalledWith("up1", expect.objectContaining({ id: "up1" }));
    expect(onOpen).not.toHaveBeenCalled();
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

  it("Mark handled button carries the shared focus-visible ring class and no inline outline suppression", () => {
    render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} />);
    const btn = screen.getByText("Mark handled").closest("button");
    expect(btn.className).toContain("sp-focus-ring");
    expect(btn.style.outline).toBe("");
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

  it("opens an upcoming item's detail from the mobile carousel", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
    const onOpen = vi.fn();
    const deadline = { id: "up1", title: "Submit report", due_date: "2026-06-22", status: "open", class_name: "Work" };
    render(
      <NeedsYouBand
        snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
        liveDeadlines={{ upcoming: [deadline] }}
        liveBills={[]}
        onOpen={onOpen}
        isMobile
      />,
    );

    fireEvent.click(screen.getByText("Submit report"));

    expect(onOpen).toHaveBeenCalledWith(
      { kind: "deadline", id: "up1", date: "2026-06-22", data: deadline },
      expect.any(HTMLElement),
    );
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

  describe("optimistic-hide revert + error surfacing (UX-02)", () => {
    it("reverts the hide and shows an inline error when onMarkHandled rejects", async () => {
      const onMarkHandled = vi.fn().mockRejectedValue(new Error("network down"));
      render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);

      await act(async () => {
        fireEvent.click(screen.getByText("Mark handled"));
      });

      await waitFor(() => expect(screen.getByText("PR blocker")).toBeTruthy());
      expect(screen.getByText(/Couldn't mark done/i)).toBeTruthy();
    });

    it("reverts the hide and shows an inline error when onCompleteDeadline resolves false", async () => {
      const onCompleteDeadline = vi.fn().mockResolvedValue(false);
      render(
        <NeedsYouBand
          snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
          liveDeadlines={{ upcoming: [{ id: "pr", title: "Ship the thing", due_date: "2020-01-01", status: "open", priority: 1, class_name: "Eng" }] }}
          liveBills={[]}
          onCompleteDeadline={onCompleteDeadline}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText("Mark done"));
      });

      await waitFor(() => expect(screen.getByText("Ship the thing")).toBeTruthy());
      expect(screen.getByText(/Couldn't mark done/i)).toBeTruthy();
    });

    it("keeps the card hidden and shows no error on a successful action", async () => {
      const onMarkHandled = vi.fn().mockResolvedValue(true);
      render(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);

      await act(async () => {
        fireEvent.click(screen.getByText("Mark handled"));
      });

      expect(screen.queryByText("PR blocker")).toBeNull();
      expect(screen.queryByText(/Couldn't mark done/i)).toBeNull();
    });
  });

  describe("Show all / Show less collapse (UX-L02)", () => {
    const manyLanes = {
      needs_attention: Array.from({ length: 7 }, (_, i) => ({
        id: i + 1, snapshot_item_id: i + 1, uid: `u${i + 1}`, lane: "needs_attention",
        from: "Riley Park", subject: `Item ${i + 1}`, read: false, urgency: "high",
      })),
      fyi: [], carryover: [],
    };

    it("desktop: 'Show all' expands all cards and swaps in a 'Show less' control; clicking it collapses back to maxCards + '+N more'", () => {
      render(
        <NeedsYouBand snapshotLanes={manyLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} maxCards={5} />,
      );

      // Collapsed: only 5 of 7 cards, plus the "+2 more" button.
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.getByText("Item 5")).toBeTruthy();
      expect(screen.queryByText("Item 6")).toBeNull();
      expect(screen.getByText("+2")).toBeTruthy();

      fireEvent.click(screen.getByText("Show all"));

      // Expanded: all 7 cards render, and a "Show less" control replaces "Show all".
      expect(screen.getByText("Item 6")).toBeTruthy();
      expect(screen.getByText("Item 7")).toBeTruthy();
      expect(screen.queryByText("Show all")).toBeNull();
      expect(screen.getByText("Show less")).toBeTruthy();

      fireEvent.click(screen.getByText("Show less"));

      // Collapsed again: back to 5 cards + "+2 more".
      expect(screen.getByText("Item 5")).toBeTruthy();
      expect(screen.queryByText("Item 6")).toBeNull();
      expect(screen.getByText("+2")).toBeTruthy();
      expect(screen.getByText("Show all")).toBeTruthy();
    });

    it("mobile: 'Show all' expands all cards in the carousel and swaps in a 'Show less' slide; clicking it collapses back", () => {
      render(
        <NeedsYouBand snapshotLanes={manyLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} maxCards={5} isMobile />,
      );

      expect(screen.getByText("Item 5")).toBeTruthy();
      expect(screen.queryByText("Item 6")).toBeNull();
      expect(screen.getByText("+2")).toBeTruthy();

      fireEvent.click(screen.getByText("Show all"));

      expect(screen.getByText("Item 6")).toBeTruthy();
      expect(screen.getByText("Item 7")).toBeTruthy();
      expect(screen.queryByText("Show all")).toBeNull();
      expect(screen.getByText("Show less")).toBeTruthy();

      fireEvent.click(screen.getByText("Show less"));

      expect(screen.getByText("Item 5")).toBeTruthy();
      expect(screen.queryByText("Item 6")).toBeNull();
      expect(screen.getByText("+2")).toBeTruthy();
      expect(screen.getByText("Show all")).toBeTruthy();
    });
  });

  describe("stale opened/handled id pruning (ARCH-06)", () => {
    it("re-surfaces a card once the server data stops containing it, then re-adds it", async () => {
      const onMarkHandled = vi.fn().mockResolvedValue(true);
      const { rerender } = render(
        <NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />,
      );

      // Mark the card handled — optimistically hidden, `handled` now holds its id.
      await act(async () => {
        fireEvent.click(screen.getByText("Mark handled"));
      });
      expect(screen.queryByText("PR blocker")).toBeNull();

      // Server data still contains the item (server hasn't caught up yet) — the
      // id must NOT be pruned, so the card stays hidden.
      rerender(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);
      expect(screen.queryByText("PR blocker")).toBeNull();

      // Server view no longer contains the item — prune fires, `handled` drops
      // the stale id.
      const emptyLanes = { needs_attention: [], fyi: [], carryover: [] };
      rerender(<NeedsYouBand snapshotLanes={emptyLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);

      // Re-add the same id via fresh server data — since it was pruned, the
      // stale `handled` entry no longer suppresses it, so it becomes visible.
      rerender(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);
      await waitFor(() => expect(screen.getByText("PR blocker")).toBeTruthy());
    });
  });
});
