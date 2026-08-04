import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ContextColumn from "./ContextColumn";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function freezeJan15() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T20:00:00Z"));
}

const baseProps = {
  liveWeather: { temp: 72, summary: "Clear", location: "San Francisco", high: 75, low: 58, icon: "Sun" },
  liveDeadlines: [{ id: "d1", title: "Finalize notes", due_date: "2026-01-16", status: "open", class_name: "Portfolio" }],
  liveBills: [{ id: "b1", name: "Demo Electric", payee: "PG&E", amount: 146.32, next_date: "2026-01-18", paid: false }],
  snapshotLanes: { needs_attention: [], fyi: [], carryover: [] },
  emailAccounts: [],
  accent: "#cba6da",
  onJump: () => {},
  onOpenInbox: () => {},
};

describe("ContextColumn", () => {
  it("jumps with the deadline payload contract when a coming-up deadline row is clicked", () => {
    freezeJan15();
    function JumpProbe() {
      const [selection, setSelection] = useState("none");
      return (
        <>
          <ContextColumn {...baseProps} onJump={(item) => setSelection(`${item.kind}:${item.id}`)} />
          <output aria-label="selected coming-up item">{selection}</output>
        </>
      );
    }
    render(<JumpProbe />);
    fireEvent.click(screen.getByText("Finalize notes"));
    expect(screen.getByRole("status", { name: "selected coming-up item" }).textContent).toBe("deadline:d1");
  });
});
