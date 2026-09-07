import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import NeedsYouBand from "./NeedsYouBand";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("NeedsYouBand", () => {

  describe("optimistic-hide revert + error surfacing (UX-02)", () => {
    it("reverts the hide and shows an inline error when onCompleteDeadline resolves false", async () => {
      const onCompleteDeadline = vi.fn().mockResolvedValue(false);
      render(
        <NeedsYouBand
          snapshotLanes={{ needs_attention: [], fyi: [], carryover: [] }}
          liveDeadlines={{ upcoming: [{ id: "pr", title: "Ship the thing", due_date: "2020-01-01", status: "open", priority: 1, class_name: "Eng" }] }}
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

});
