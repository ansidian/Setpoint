import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import NoteEditor from "./NoteEditor";
import type { NoteEditorApi } from "./NoteEditor";

describe("NoteEditor", () => {
  afterEach(cleanup);

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

  it.each([
    ["plain text", "hello world", "hello world"],
    ["markdown decorations", "a **bold** _em_ `code` #tag\n# heading\n- [ ] todo", "bold"],
  ])("mounts the public editing surface with %s content", (_label, value, visibleText) => {
    render(<NoteEditor value={value} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Note" }).textContent).toContain(visibleText);
  });

  it("calls onSubmit with the doc via the imperative handle", () => {
    const onSubmit = vi.fn();
    const apiRef = createRef<NoteEditorApi>();
    render(<NoteEditor value="note text" submitOnEnter onSubmit={onSubmit} editorApiRef={apiRef} />);
    apiRef.current!.submit();
    expect(onSubmit).toHaveBeenCalledWith("note text");
  });

  it.each([
    ["custom", "New note", "New note"],
    ["default", undefined, "Note"],
  ])("exposes the %s accessible name", (_label, ariaLabel, expectedName) => {
    render(<NoteEditor value="hello" ariaLabel={ariaLabel} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: expectedName })).toBeTruthy();
  });
});
