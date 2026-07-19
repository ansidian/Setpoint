
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useEditorCancelOnScroll from "./useEditorCancelOnScroll";

function setup(overrides: Partial<Parameters<typeof useEditorCancelOnScroll>[0]> = {}) {
  const onCancelFloatingEditor = vi.fn();
  const props = {
    floatingDetailOpen: true,
    floatingDetailMode: "create",
    floatingEditorDirty: false,
    onCancelFloatingEditor,
    ...overrides,
  };
  const hook = renderHook((currentProps) => useEditorCancelOnScroll(currentProps), {
    initialProps: props,
  });
  return { ...hook, onCancelFloatingEditor, props };
}

describe("useEditorCancelOnScroll", () => {
  it("cancels a clean editor once on owner scrolling", () => {
    const { result, onCancelFloatingEditor } = setup();

    act(() => result.current(false));
    act(() => result.current(false));

    expect(onCancelFloatingEditor).toHaveBeenCalledTimes(1);
  });

  it("preserves clean editors during programmatic navigation scrolling", () => {
    const { result, onCancelFloatingEditor } = setup();

    act(() => result.current(true));

    expect(onCancelFloatingEditor).not.toHaveBeenCalled();
  });

  it("preserves dirty editors during owner scrolling", () => {
    const { result, onCancelFloatingEditor } = setup({ floatingEditorDirty: true });

    act(() => result.current(false));

    expect(onCancelFloatingEditor).not.toHaveBeenCalled();
  });

  it("resets the one-shot cancellation latch for a new editor session", () => {
    const { result, onCancelFloatingEditor, props, rerender } = setup();

    act(() => result.current(false));
    rerender({ ...props, floatingDetailMode: "edit" });
    act(() => result.current(false));

    expect(onCancelFloatingEditor).toHaveBeenCalledTimes(2);
  });
});
