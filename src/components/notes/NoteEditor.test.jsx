import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import NoteEditor from "./NoteEditor.jsx";

describe("NoteEditor", () => {
  it("does not fire onBlur when the editor is torn down (StrictMode remount / unmount)", () => {
    // Regression: under StrictMode the mount effect runs mount->cleanup->mount; the
    // cleanup's view.destroy() blurs the just-focused editor. Routing that teardown
    // blur to onBlur made an inline-edit NoteItem commit+close immediately — the
    // "editing auto-cancels before I can edit" bug. The destroying-flag guard in
    // NoteEditor must swallow blur events emitted during view.destroy().
    const onBlur = vi.fn();
    render(
      <StrictMode>
        <NoteEditor value="x" autoFocus onBlur={onBlur} onChange={() => {}} />
      </StrictMode>,
    );
    expect(onBlur).not.toHaveBeenCalled();
  });

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

  it("renders with a custom ariaLabel on the content editor", () => {
    const { container } = render(
      <NoteEditor value="hello" ariaLabel="New note" onChange={() => {}} />,
    );
    const contentEl = container.querySelector(".cm-content");
    expect(contentEl).toBeTruthy();
    expect(contentEl?.getAttribute("aria-label")).toBe("New note");
  });

  it("renders with the default ariaLabel when not specified", () => {
    const { container } = render(
      <NoteEditor value="hello" onChange={() => {}} />,
    );
    const contentEl = container.querySelector(".cm-content");
    expect(contentEl).toBeTruthy();
    expect(contentEl?.getAttribute("aria-label")).toBe("Note");
  });
});
