import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErrorLine,
  ModelToggle,
  SayBlock,
  SuggestionList,
  ToolRows,
  UserLine,
} from "./AlfredMessages.jsx";

afterEach(cleanup);

describe("alfred message primitives", () => {
  it("UserLine renders the text right-aligned in an accent bubble", () => {
    render(<UserLine accent="#cba6da" text="What's left today?" />);
    expect(screen.getByText("What's left today?")).toBeTruthy();
  });

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

  it("SayBlock splits the lead sentence from the body", () => {
    render(<SayBlock text="Two things need you. The rest can wait." done />);
    expect(screen.getByText("Two things need you.")).toBeTruthy();
    expect(screen.getByText("The rest can wait.")).toBeTruthy();
  });

  it("ErrorLine renders the message", () => {
    render(<ErrorLine text="Alfred could not complete this run." />);
    expect(screen.getByText("Alfred could not complete this run.")).toBeTruthy();
  });

  it("SuggestionList submits the picked suggestion", () => {
    const onPick = vi.fn();
    render(<SuggestionList accent="#cba6da" onPick={onPick} />);
    fireEvent.click(screen.getByText("Anything in mail that needs me?"));
    expect(onPick).toHaveBeenCalledWith("Anything in mail that needs me?");
  });

  it("ModelToggle switches between haiku and sonnet", () => {
    const onChange = vi.fn();
    render(<ModelToggle accent="#cba6da" modelKey="sonnet" onChange={onChange} />);
    fireEvent.click(screen.getByText("haiku"));
    expect(onChange).toHaveBeenCalledWith("haiku");
  });
});
