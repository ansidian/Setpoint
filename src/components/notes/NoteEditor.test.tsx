import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NoteEditor from "./NoteEditor";

describe("NoteEditor", () => {
  afterEach(cleanup);

  it.each([
    ["plain text", "hello world", "hello world"],
    ["markdown decorations", "a **bold** _em_ `code` #tag\n# heading\n- [ ] todo", "bold"],
  ])("mounts the public editing surface with %s content", (_label, value, visibleText) => {
    render(<NoteEditor value={value} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Note" }).textContent).toContain(visibleText);
  });

  it.each([
    ["custom", "New note", "New note"],
    ["default", undefined, "Note"],
  ])("exposes the %s accessible name", (_label, ariaLabel, expectedName) => {
    render(<NoteEditor value="hello" ariaLabel={ariaLabel} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: expectedName })).toBeTruthy();
  });
});
