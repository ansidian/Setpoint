import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ComingUpCard from "./ComingUpCard.jsx";

afterEach(cleanup);

const deadlineRow = { id: "deadline:d1", kind: "deadline", title: "Finalize notes", meta: "Portfolio", chipLabel: "Tomorrow", chipTone: "cream" };
const billRow = { id: "bill:b1", kind: "bill", title: "Demo Electric", meta: "$146.32 · PG&E", chipLabel: "In 3d", chipTone: "muted" };

describe("ComingUpCard", () => {
  it("offers a 'Mark done' action on deadline rows that completes and optimistically removes the row", () => {
    const onComplete = vi.fn();
    render(<ComingUpCard items={[deadlineRow]} onJump={vi.fn()} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Finalize notes done" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "deadline:d1" }));
    expect(screen.queryByText("Finalize notes")).toBeNull();
  });

  it("does not offer 'Mark done' on bill rows (bills aren't Todoist items)", () => {
    render(<ComingUpCard items={[billRow]} onJump={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText("Demo Electric")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Mark .+ done$/i })).toBeNull();
  });

  it("completing does not also fire row navigation (the action stops propagation)", () => {
    const onJump = vi.fn();
    render(<ComingUpCard items={[deadlineRow]} onJump={onJump} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Finalize notes done" }));
    expect(onJump).not.toHaveBeenCalled();
  });

  it("renders no action affordance when onComplete is omitted", () => {
    render(<ComingUpCard items={[deadlineRow]} onJump={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Mark .+ done$/i })).toBeNull();
  });
});
