import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderNoteMarkdown } from "./renderNoteMarkdown.jsx";
import { toggleCheckboxLine } from "./noteEditorExtensions.js";

describe("renderNoteMarkdown", () => {
  afterEach(cleanup);

  it("renders bold and italic", () => {
    render(<div>{renderNoteMarkdown("a **bold** and *em* word")}</div>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("em").tagName).toBe("EM");
  });

  it("renders #tags as chips and keeps the # in the label", () => {
    render(<div>{renderNoteMarkdown("plan #home-office today")}</div>);
    expect(screen.getByText("#home-office").getAttribute("data-note-tag")).toBe("home-office");
  });

  it("linkifies bare URLs", () => {
    render(<div>{renderNoteMarkdown("see https://example.com now")}</div>);
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link.getAttribute("href")).toBe("https://example.com");
  });

  it("renders a leading checkbox and toggles via onToggleCheckbox", () => {
    const onToggle = vi.fn();
    render(<div>{renderNoteMarkdown("- [ ] buy milk", { onToggleCheckbox: onToggle })}</div>);
    const box = screen.getByRole("checkbox", { name: /buy milk/i });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("does not chip a # mid-word (matches parseTags anchoring)", () => {
    render(<div>{renderNoteMarkdown("see issue#123 later")}</div>);
    expect(screen.queryByText("#123")).toBeNull();
  });

  it("renderer and toggleCheckboxLine agree on checkbox index, ignoring malformed boxes", () => {
    // A bare `- [x]` (no space after ]) is NOT a togglable checkbox in either module.
    const content = "- [x]\n- [ ] buy milk";
    const onToggle = vi.fn();
    render(<div>{renderNoteMarkdown(content, { onToggleCheckbox: onToggle })}</div>);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(1); // only the well-formed checkbox renders
    fireEvent.click(boxes[0]);
    expect(onToggle).toHaveBeenCalledWith(0);
    // index 0 from the renderer flips the SAME line in the toggle util
    expect(toggleCheckboxLine(content, 0)).toBe("- [x]\n- [x] buy milk");
  });
});
