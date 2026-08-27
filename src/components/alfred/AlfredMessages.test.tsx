import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

  it("SayBlock renders streaming text quietly in one block (no promoted pseudo-heading)", () => {
    // While streaming (not done), don't promote the first sentence to a strong
    // lead — that's what made every dropped preamble flash as a heading.
    render(<SayBlock text="Two things need you. The rest can wait." />);
    expect(screen.getByText("Two things need you. The rest can wait.")).toBeTruthy();
    expect(screen.queryByText("The rest can wait.")).toBeNull(); // not split out yet
  });

  it("SayBlock renders a completed answer as one paragraph with a semibold opening sentence", () => {
    const { container } = render(<SayBlock text="Two things need you. The rest can wait." done />);
    const answer = container.querySelector<HTMLElement>('[data-alfred-message-kind="answer"]');
    const opening = answer?.querySelector<HTMLElement>("strong");

    expect(answer?.textContent).toBe("Two things need you. The rest can wait.");
    expect(answer?.style.fontFamily).toBe("var(--font-sans)");
    expect(answer?.style.fontSize).toBe("12.5px");
    expect(answer?.querySelectorAll("p")).toHaveLength(1);
    expect(opening?.textContent).toBe("Two things need you.");
    expect(opening?.style.fontWeight).toBe("600");
  });

  it("SayBlock does not split its automatic opening emphasis at a decimal point", () => {
    const { container } = render(<SayBlock text="Rent is $1,850.00 due Friday. Nothing else is due." done />);
    expect(container.querySelector("strong")?.textContent).toBe("Rent is $1,850.00 due Friday.");
  });

  it("SayBlock renders paragraphs plus unordered and numbered lists", () => {
    const { container } = render(<SayBlock text={[
      "Amazon changed its terms. Key updates:",
      "",
      "- Most disputes require **individual arbitration**.",
      "- Small-claims court remains available.",
      "",
      "1. Review the changes.",
      "2. Decide whether they matter to you.",
    ].join("\n")} done />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByText("individual arbitration").tagName).toBe("STRONG");
    expect(container.textContent).not.toContain("- Most disputes");
  });

  it("SayBlock supports inline emphasis, code, and safe links without interpreting HTML", () => {
    const { container } = render(<SayBlock
      text={'Details. Use *care*, run `check`, and read [the source](https://example.com). <script>alert("x")</script>'}
      done
    />);

    expect(screen.getByText("care").tagName).toBe("EM");
    expect(screen.getByText("check").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "the source" }).getAttribute("href")).toBe("https://example.com");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
  });

  it("SayBlock leaves unsafe Markdown links as literal text", () => {
    const { container } = render(<SayBlock text="Details. [Open](javascript:alert(1))" done />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
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
    function Harness() {
      const [picked, setPicked] = useState("none");
      return <><SuggestionList accent="#cba6da" onPick={setPicked} /><output>{picked}</output></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Anything in mail that needs me?"));
    expect(screen.getAllByText("Anything in mail that needs me?")).toHaveLength(2);
  });

});
