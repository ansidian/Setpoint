import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ComingUpCard from "./ComingUpCard";
import type { ComingUpRow } from "./comingUpModel";

afterEach(cleanup);

const deadlineRow: ComingUpRow = { id: "deadline:d1", kind: "deadline", title: "Finalize notes", meta: "Portfolio", chipLabel: "Tomorrow", chipTone: "cream" };
const billRow: ComingUpRow = { id: "bill:b1", kind: "bill", title: "Demo Electric", meta: "$146.32 · PG&E", chipLabel: "In 3d", chipTone: "muted" };

describe("ComingUpCard", () => {
  it("offers a 'Mark done' action on deadline rows that completes and optimistically removes the row", () => {
    render(<ComingUpCard items={[deadlineRow]} onJump={() => {}} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Finalize notes done" }));
    expect(screen.queryByText("Finalize notes")).toBeNull();
  });

  it("does not offer 'Mark done' on bill rows (bills aren't Todoist items)", () => {
    render(<ComingUpCard items={[billRow]} onJump={() => {}} onComplete={() => {}} />);
    expect(screen.getByText("Demo Electric")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Mark .+ done$/i })).toBeNull();
  });

  it("renders no action affordance when onComplete is omitted", () => {
    render(<ComingUpCard items={[deadlineRow]} onJump={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Mark .+ done$/i })).toBeNull();
  });
});
