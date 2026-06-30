import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ContextColumn from "./ContextColumn.jsx";

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
  onJump: vi.fn(),
  onOpenInbox: vi.fn(),
};

describe("ContextColumn", () => {
  it("stacks the three context sections: weather, coming up, inbox peek", () => {
    freezeJan15();
    render(<ContextColumn {...baseProps} />);
    expect(screen.getByTestId("dashboard-context-column")).toBeTruthy();
    expect(screen.getByTestId("context-weather")).toBeTruthy();
    expect(screen.getByTestId("context-coming-up")).toBeTruthy();
    expect(document.querySelector('[data-sect="inbox-peek"]')).toBeTruthy();
  });

  it("renders coming-up rows from the merged deadline+bill feed", () => {
    freezeJan15();
    render(<ContextColumn {...baseProps} />);
    expect(screen.getByText("Finalize notes")).toBeTruthy();
    expect(screen.getByText("Demo Electric")).toBeTruthy();
  });

  it("jumps with the deadline payload contract when a coming-up deadline row is clicked", () => {
    freezeJan15();
    const onJump = vi.fn();
    render(<ContextColumn {...baseProps} onJump={onJump} />);
    fireEvent.click(screen.getByText("Finalize notes"));
    // Second arg is the clicked element (the desktop glance-sheet anchor).
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ kind: "deadline", id: "d1" }), expect.anything());
  });
});
