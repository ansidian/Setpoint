import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import useInboxSelectionHistory from "./useInboxSelectionHistory";

function useHarness({ enabled }) {
  const [selectedId, setSelectedId] = useState(null);
  const close = useInboxSelectionHistory({ selectedId, setSelectedId, enabled });
  return { selectedId, setSelectedId, close };
}

describe("useInboxSelectionHistory", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("pushes a reader history entry on first selection when enabled (desktop)", () => {
    const { result } = renderHook(() => useHarness({ enabled: true }));

    act(() => {
      result.current.setSelectedId("e1");
    });

    expect(window.history.state?.eaInboxNav?.selectedId).toBe("e1");

    act(() => {
      result.current.close();
    });

    expect(result.current.selectedId).toBe(null);
  });

  it("never touches browser history when disabled (mobile: DashboardShell owns it)", () => {
    const { result } = renderHook(() => useHarness({ enabled: false }));

    // Mount must not seed an eaInboxNav entry.
    expect(window.history.state?.eaInboxNav).toBeUndefined();

    act(() => {
      result.current.setSelectedId("e1");
    });

    // Selecting must not push/replace an eaInboxNav entry either.
    expect(window.history.state?.eaInboxNav).toBeUndefined();

    // Closing is a plain state clear, not a history.back().
    act(() => {
      result.current.close();
    });
    expect(result.current.selectedId).toBe(null);
    expect(window.history.state?.eaInboxNav).toBeUndefined();
  });
});
