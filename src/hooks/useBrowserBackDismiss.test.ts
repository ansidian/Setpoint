import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.restoreAllMocks();
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

  it("unwinds its history entry on unmount while still enabled (mount-style consumers)", () => {
    const backSpy = vi.spyOn(window.history, "back");
    const { unmount } = renderHook(() => useBrowserBackDismiss({
      enabled: true,
      historyKey: "eaTestUnmountDismiss",
      onDismiss: () => {},
    }));

    expect(window.history.state.eaTestUnmountDismiss).toBeTruthy();

    unmount();

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("does not unwind again on unmount after the entry was already popped", async () => {
    const onDismiss = vi.fn();
    const { unmount } = renderHook(() => useBrowserBackDismiss({
      enabled: true,
      historyKey: "eaTestPopThenUnmount",
      onDismiss,
    }));

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    const backSpy = vi.spyOn(window.history, "back");
    unmount();

    expect(backSpy).not.toHaveBeenCalled();
  });
});
