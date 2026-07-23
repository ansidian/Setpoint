import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderNoteMarkdown } from "./renderNoteMarkdown";
import { toggleCheckboxLine } from "./noteEditorExtensions";

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

  it("renders a [label](url) markdown link with the label as the anchor text", () => {
    render(<div>{renderNoteMarkdown("see [Anthropic](https://anthropic.com) docs")}</div>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
  });

  it("does NOT render a javascript: link — leaves it as literal text (XSS-safe)", () => {
    const { container } = render(<div>{renderNoteMarkdown("[x](javascript:alert(1))")}</div>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });

  it("renders a leading checkbox and toggles via onToggleCheckbox", () => {
    const onToggle = vi.fn();
    render(<div>{renderNoteMarkdown("- [ ] buy milk", { onToggleCheckbox: onToggle })}</div>);
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: /buy milk/i });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("does not chip a # mid-word (matches parseTags anchoring)", () => {
    render(<div>{renderNoteMarkdown("see issue#123 later")}</div>);
    expect(screen.queryByText("#123")).toBeNull();
  });

  it("treats '# Heading' (space after #) as a heading, not a tag", () => {
    // The heading and #tag grammars are disjoint: '# x' is a heading, '#x' is a tag.
    const { container } = render(<div>{renderNoteMarkdown("# Heading")}</div>);
    expect(screen.getByText("Heading")).toBeTruthy();
    expect(container.querySelector("[data-note-tag]")).toBeNull();
  });

  it("keeps an inline #tag chip inside a heading line", () => {
    render(<div>{renderNoteMarkdown("# My #project notes")}</div>);
    const heading = screen.getByRole("heading", { name: "My #project notes" });
    expect(heading.querySelector('[data-note-tag="project"]')).toBeTruthy();
  });

  it("chips a numeric #tag like #5", () => {
    render(<div>{renderNoteMarkdown("ship #5 today")}</div>);
    expect(screen.getByText("#5").getAttribute("data-note-tag")).toBe("5");
  });

  it("renderer and toggleCheckboxLine agree on checkbox index, ignoring malformed boxes", () => {
    // A bare `- [x]` (no space after ]) is NOT a togglable checkbox in either module.
    const content = "- [x]\n- [ ] buy milk";
    const onToggle = vi.fn();
    render(<div>{renderNoteMarkdown(content, { onToggleCheckbox: onToggle })}</div>);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(1); // only the well-formed checkbox renders
    fireEvent.click(boxes[0]!);
    expect(onToggle).toHaveBeenCalledWith(0);
    // index 0 from the renderer flips the SAME line in the toggle util
    expect(toggleCheckboxLine(content, 0)).toBe("- [x]\n- [x] buy milk");
  });
});
