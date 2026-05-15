import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import useBrowserBackDismiss from "./useBrowserBackDismiss";

function useDismissHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);

  const dismissParent = useBrowserBackDismiss({
    enabled: parentOpen,
    historyKey: "eaTestParentDismiss",
    onDismiss: () => setParentOpen(false),
  });
  const dismissChild = useBrowserBackDismiss({
    enabled: childOpen,
    historyKey: "eaTestChildDismiss",
    onDismiss: () => setChildOpen(false),
  });

  return {
    parentOpen,
    childOpen,
    setParentOpen,
    setChildOpen,
    dismissParent,
    dismissChild,
  };
}

describe("useBrowserBackDismiss", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("closes an owned surface when browser back is pressed", async () => {
    const { result } = renderHook(() => useDismissHarness());

    act(() => {
      result.current.setParentOpen(true);
    });

    expect(result.current.parentOpen).toBe(true);
    expect(window.history.state.eaTestParentDismiss).toBeTruthy();

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(result.current.parentOpen).toBe(false);
    });
  });

  it("unwinds the deepest owned surface first", async () => {
    const { result } = renderHook(() => useDismissHarness());

    act(() => {
      result.current.setParentOpen(true);
    });
    act(() => {
      result.current.setChildOpen(true);
    });

    expect(result.current.parentOpen).toBe(true);
    expect(result.current.childOpen).toBe(true);

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(result.current.childOpen).toBe(false);
      expect(result.current.parentOpen).toBe(true);
    });

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(result.current.parentOpen).toBe(false);
    });
  });
});
