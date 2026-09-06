import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import NeedsYouBand from "./NeedsYouBand";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const snapshotLanes = {
  needs_attention: [{ id: 1, snapshot_item_id: 1, uid: "u1", lane: "needs_attention", from: "Riley Park", subject: "PR blocker", read: false, urgency: "high" }],
  fyi: [], carryover: [],
};

describe("NeedsYouBand", () => {

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
      expect(screen.queryByRole("button", { name: /^Open email: PR blocker/ })).toBeNull();

      // Server data still contains the item (server hasn't caught up yet) — the
      // id must NOT be pruned, so the card stays hidden.
      rerender(<NeedsYouBand snapshotLanes={snapshotLanes} liveDeadlines={{ upcoming: [] }} liveBills={[]} onMarkHandled={onMarkHandled} />);
      expect(screen.queryByRole("button", { name: /^Open email: PR blocker/ })).toBeNull();

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
