import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadlineDetailPopover from "./DeadlineDetailPopover.jsx";

const handleCompleteTask = vi.fn();
vi.mock("../../context/DashboardContext", () => ({
  useDashboard: () => ({ handleCompleteTask, handleUpdateTask: vi.fn() }),
}));

afterEach(() => { cleanup(); handleCompleteTask.mockClear(); });

const task = { id: "t1", title: "Submit report", status: "open", due_date: "2026-06-25", priority: 1 };

describe("DeadlineDetailPopover (mobile sheet)", () => {
  it("renders the deadline detail through a BottomSheet (sheet Close + title)", () => {
    render(<DeadlineDetailPopover task={task} onClose={() => {}} />);
    expect(screen.getByText("Submit report")).toBeTruthy();
    // The BottomSheet header provides the single Close affordance.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("Mark complete routes through the dashboard completer", () => {
    render(<DeadlineDetailPopover task={task} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Mark complete"));
    expect(handleCompleteTask).toHaveBeenCalledWith("t1", task);
  });

  it("shows deadline-domain actions only (no Canvas/CTM/in-progress/reopen branches)", () => {
    render(
      <DeadlineDetailPopover
        task={{ id: "deadline-1", title: "Submit packet", due_date: "2026-05-07", class_name: "School", source: "canvas", status: "open", priority: 2 }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Submit packet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open canvas/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open ctm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /in progress/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });
});
