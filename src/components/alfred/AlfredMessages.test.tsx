import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SayBlock,
  SuggestionList,
  ToolRows,
  ToolSteps,
} from "./AlfredMessages";
import type { AlfredToolEntry } from "./alfredPanelModel";

afterEach(cleanup);

describe("alfred message primitives", () => {
  it("ToolRows shows running label, done summary, and error summary", () => {
    render(<ToolRows accent="#cba6da" tools={[
      { toolId: "t1", name: "search_email", state: "running", summary: null },
      { toolId: "t2", name: "get_upcoming_bills", state: "done", summary: "Bills · 6 upcoming" },
      { toolId: "t3", name: "get_email_body", state: "error", summary: "Mail · failed" },
    ]} />);
    expect(screen.getByText("Searching mail…")).toBeTruthy();
    expect(screen.getByText("Bills · 6 upcoming")).toBeTruthy();
    expect(screen.getByText("Mail · failed")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull(); // no client-side retry by design
  });

  it("SayBlock renders streaming text quietly in one block (no serif pseudo-header)", () => {
    // While streaming (not done), don't promote the first sentence to a serif
    // lead — that's what made every dropped preamble flash as a header.
    render(<SayBlock text="Two things need you. The rest can wait." />);
    expect(screen.getByText("Two things need you. The rest can wait.")).toBeTruthy();
    expect(screen.queryByText("The rest can wait.")).toBeNull(); // not split out yet
  });

  it("ToolSteps shows the full step trail and live count while the run is in flight", () => {
    render(<ToolSteps accent="#cba6da" done={false} tools={[
      { toolId: "t1", name: "search_email", state: "done", summary: "Mail · 4 matches" },
      { toolId: "t2", name: "get_email_body", state: "running", summary: null },
    ]} />);
    // The trail accumulates live: completed steps keep their summaries and the
    // in-flight step shows its activity — not just the latest line.
    expect(screen.getByText("Mail · 4 matches")).toBeTruthy();
    expect(screen.getByText("Reading message…")).toBeTruthy();
    // …under a live "N steps" count, the same disclosure idiom as the settled state.
    expect(screen.getByText(/2 steps/)).toBeTruthy();
  });

  it("ToolSteps keeps the trail open while running, then collapses it on done", () => {
    const tools: AlfredToolEntry[] = [
      { toolId: "t1", name: "search_email", state: "done", summary: "Mail · 4 matches" },
      { toolId: "t2", name: "get_email_body", state: "done", summary: "Mail · opened message" },
    ];
    const { rerender } = render(<ToolSteps accent="#cba6da" done={false} tools={tools} />);
    expect(screen.getByText("Mail · 4 matches")).toBeTruthy(); // open while running
    rerender(<ToolSteps accent="#cba6da" done tools={tools} />);
    // Settling collapses the trail back to the disclosure (owner can reopen it).
    expect(screen.queryByText("Mail · 4 matches")).toBeNull();
    expect(screen.getByRole("button", { name: /2 steps/ })).toBeTruthy();
  });

  it("ToolSteps collapses to a steps disclosure once done, expanding to the chips on click", () => {
    render(<ToolSteps accent="#cba6da" done tools={[
      { toolId: "t1", name: "search_email", state: "done", summary: "Mail · 4 matches" },
      { toolId: "t2", name: "get_email_body", state: "done", summary: "Mail · opened message" },
    ]} />);
    const toggle = screen.getByRole("button", { name: /2 steps/ });
    expect(toggle).toBeTruthy();
    // Chips are hidden until the owner opts in.
    expect(screen.queryByText("Mail · 4 matches")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Mail · 4 matches")).toBeTruthy();
    expect(screen.getByText("Mail · opened message")).toBeTruthy();
  });

  it("ToolSteps singularizes the step count", () => {
    render(<ToolSteps accent="#cba6da" done tools={[
      { toolId: "t1", name: "search_email", state: "done", summary: "Mail · 4 matches" },
    ]} />);
    expect(screen.getByRole("button", { name: /1 step\b/ })).toBeTruthy();
  });

  it("SuggestionList submits the picked suggestion", () => {
    const onPick = vi.fn();
    render(<SuggestionList accent="#cba6da" onPick={onPick} />);
    fireEvent.click(screen.getByText("Anything in mail that needs me?"));
    expect(onPick).toHaveBeenCalledWith("Anything in mail that needs me?");
  });

});
