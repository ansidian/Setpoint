import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import MarkDoneAction from "./MarkDoneAction";

afterEach(cleanup);

describe("MarkDoneAction", () => {
  it("provides an item-specific accessible name", () => {
    render(<MarkDoneAction onComplete={() => {}} itemTitle="Report" />);
    expect(screen.getByRole("button", { name: "Mark Report done" })).toBeTruthy();
  });

  it("runs completion without bubbling into its parent row", () => {
    function CompletionProbe() {
      const [completion, setCompletion] = useState("idle");
      const [parent, setParent] = useState("idle");
      return (
        <div onClick={() => setParent("opened")}>
          <MarkDoneAction onComplete={() => setCompletion("completed")} itemTitle="Report" alwaysVisible />
          <output aria-label="completion state">{completion}</output>
          <output aria-label="parent state">{parent}</output>
        </div>
      );
    }
    render(<CompletionProbe />);
    const btn = screen.getByRole("button", { name: "Mark Report done" });
    fireEvent.click(btn);
    expect(screen.getByRole("status", { name: "completion state" }).textContent).toBe("completed");
    expect(screen.getByRole("status", { name: "parent state" }).textContent).toBe("idle");
  });
});
