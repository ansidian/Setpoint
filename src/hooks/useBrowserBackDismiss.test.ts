import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
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

  it("keeps Back owned while a dirty editor or its detail stays open", async () => {
    const { result } = renderHook(() => {
      const [mode, setMode] = useState("editor");
      const [dirty, setDirty] = useState(true);
      useBrowserBackDismiss({
        enabled: mode !== "closed",
        historyKey: "eaTestGuardedEditor",
        onDismiss: () => {
          if (dirty) return false;
          if (mode === "editor") { setMode("detail"); return false; }
          setMode("closed");
          return true;
        },
      });
      return { mode, setDirty };
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = window.history.state.eaTestGuardedEditor;
      act(() => window.history.back());
      await waitFor(() => {
        expect(window.history.state.eaTestGuardedEditor).toBeTruthy();
        expect(window.history.state.eaTestGuardedEditor).not.toBe(token);
      });
      expect(result.current.mode).toBe("editor");
    }

    act(() => result.current.setDirty(false));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.mode).toBe("detail"));
    expect(window.history.state.eaTestGuardedEditor).toBeTruthy();
    act(() => window.history.back());
    await waitFor(() => expect(result.current.mode).toBe("closed"));
    expect(window.history.state.eaTestGuardedEditor).toBeUndefined();
  });

  it("unwinds its history entry on unmount while still enabled (mount-style consumers)", async () => {
    const { unmount } = renderHook(() => useBrowserBackDismiss({
      enabled: true,
      historyKey: "eaTestUnmountDismiss",
      onDismiss: () => {},
    }));

    expect(window.history.state.eaTestUnmountDismiss).toBeTruthy();

    unmount();

    await waitFor(() => expect(window.history.state.eaTestUnmountDismiss).toBeUndefined());
  });

  it("does not unwind a newly pushed entry during Strict Mode's simulated unmount", () => {
    renderHook(() => useBrowserBackDismiss({
      enabled: true,
      historyKey: "eaTestStrictDismiss",
      onDismiss: () => {},
    }), { wrapper: StrictMode });

    expect(window.history.state.eaTestStrictDismiss).toBeTruthy();
  });

  it("does not unwind again on unmount after the entry was already popped", async () => {
    let dismissCount = 0;
    const { unmount } = renderHook(() => useBrowserBackDismiss({
      enabled: true,
      historyKey: "eaTestPopThenUnmount",
      onDismiss: () => { dismissCount += 1; },
    }));

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(dismissCount).toBe(1);
    });

    unmount();

    expect(window.history.state.eaTestPopThenUnmount).toBeUndefined();
  });
});
