import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkDoneAction from "./MarkDoneAction";

afterEach(cleanup);

describe("MarkDoneAction", () => {
  it("provides an item-specific accessible name", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" />);
    expect(screen.getByRole("button", { name: "Mark Report done" })).toBeTruthy();
  });

  it("runs completion without bubbling into its parent row", () => {
    const onComplete = vi.fn();
    const onParentClick = vi.fn();
    render(<div onClick={onParentClick}><MarkDoneAction onComplete={onComplete} itemTitle="Report" alwaysVisible /></div>);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    fireEvent.click(btn);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
