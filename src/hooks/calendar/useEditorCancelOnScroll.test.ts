
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import useEditorCancelOnScroll from "./useEditorCancelOnScroll";

function setup(overrides: Partial<Parameters<typeof useEditorCancelOnScroll>[0]> = {}) {
  const props = {
    floatingDetailOpen: true,
    floatingDetailMode: "create",
    floatingEditorDirty: false,
    ...overrides,
  };
  const hook = renderHook((currentProps) => {
    const [cancelCount, setCancelCount] = useState(0);
    const maybeCancel = useEditorCancelOnScroll({
      ...currentProps,
      onCancelFloatingEditor: () => setCancelCount((count) => count + 1),
    });
    return { maybeCancel, cancelCount };
  }, {
    initialProps: props,
  });
  return { ...hook, props };
}

describe("useEditorCancelOnScroll", () => {
  it("cancels a clean editor once on owner scrolling", () => {
    const { result } = setup();

    act(() => result.current.maybeCancel(false));
    act(() => result.current.maybeCancel(false));

    expect(result.current.cancelCount).toBe(1);
  });

  it("preserves clean editors during programmatic navigation scrolling", () => {
    const { result } = setup();

    act(() => result.current.maybeCancel(true));

    expect(result.current.cancelCount).toBe(0);
  });

  it("preserves dirty editors during owner scrolling", () => {
    const { result } = setup({ floatingEditorDirty: true });

    act(() => result.current.maybeCancel(false));

    expect(result.current.cancelCount).toBe(0);
  });

  it("resets the one-shot cancellation latch for a new editor session", () => {
    const { result, props, rerender } = setup();

    act(() => result.current.maybeCancel(false));
    rerender({ ...props, floatingDetailMode: "edit" });
    act(() => result.current.maybeCancel(false));

    expect(result.current.cancelCount).toBe(2);
  });
});
