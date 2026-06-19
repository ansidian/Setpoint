import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import NoteEditor from "./NoteEditor.jsx";

describe("NoteEditor", () => {
  it("mounts a CM editor showing the initial value", () => {
    const { container } = render(<NoteEditor value="hello world" onChange={() => {}} />);
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("hello world");
  });

  it("calls onSubmit with the doc via the imperative handle", () => {
    const onSubmit = vi.fn();
    const apiRef = createRef();
    render(<NoteEditor value="note text" submitOnEnter onSubmit={onSubmit} editorApiRef={apiRef} />);
    apiRef.current.submit();
    expect(onSubmit).toHaveBeenCalledWith("note text");
  });

  it("mounts with markdown content without throwing (live-preview decorations build)", () => {
    // Exercises the livePreview/tagChips decoration path that plain-text values
    // skip — a bad RangeSetBuilder add-order would throw here, not in the
    // "hello world" test above.
    const { container } = render(
      <NoteEditor value={"a **bold** _em_ `code` #tag\n# heading\n- [ ] todo"} onChange={() => {}} />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });
});
