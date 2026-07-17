import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import useInboxSelectionHistory from "./useInboxSelectionHistory";
import type { InboxSelectionId } from "../../components/inbox/inboxTypes";

function useHarness({ enabled }: { enabled: boolean }) {
  const [selectedId, setSelectedId] = useState<InboxSelectionId>(null);
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

  it("restores the prior selection when a popstate carries an earlier eaInboxNav entry", () => {
    const { result } = renderHook(() => useHarness({ enabled: true }));

    act(() => {
      result.current.setSelectedId("e1");
    });

    // The live entry is "e1"; grab the same-session shape so we can simulate
    // navigating back to an earlier entry that held a different selection.
    const liveNav = window.history.state.eaInboxNav;
    expect(liveNav.selectedId).toBe("e1");

    const priorState = {
      eaInboxNav: { sessionId: liveNav.sessionId, selectedId: "e0" },
    };

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: priorState }));
    });

    // A back navigation to the earlier entry restores that entry's selection.
    expect(result.current.selectedId).toBe("e0");
  });

  it("clears the selection when a popstate carries the seeded (null) entry", () => {
    const { result } = renderHook(() => useHarness({ enabled: true }));

    act(() => {
      result.current.setSelectedId("e1");
    });
    const sessionId = window.history.state.eaInboxNav.sessionId;

    // Navigating back past the first selection lands on the seeded null entry.
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { eaInboxNav: { sessionId, selectedId: null } },
        }),
      );
    });

    expect(result.current.selectedId).toBe(null);
  });

  it("replaces (does not push) history when switching directly between two emails", () => {
    const { result } = renderHook(() => useHarness({ enabled: true }));

    const baseLength = window.history.length;

    act(() => {
      result.current.setSelectedId("e1");
    });

    // First selection from an empty reader is a genuine push: one new entry.
    expect(window.history.length).toBe(baseLength + 1);
    expect(window.history.state.eaInboxNav.selectedId).toBe("e1");

    act(() => {
      result.current.setSelectedId("e2");
    });

    // Switching reader-to-reader must replace in place: no extra entry stacks up,
    // but the live state reflects the new selection.
    expect(window.history.length).toBe(baseLength + 1);
    expect(window.history.state.eaInboxNav.selectedId).toBe("e2");
  });

  it("steps the browser history back to the prior entry when close() is called after a selection", () => {
    const { result } = renderHook(() => useHarness({ enabled: true }));

    act(() => {
      result.current.setSelectedId("e1");
    });
    expect(window.history.state.eaInboxNav.selectedId).toBe("e1");

    act(() => {
      result.current.close();
    });

    // close() pops the reader entry off the stack, so the live history state
    // reflects the back navigation to the seeded (no-selection) entry.
    expect(result.current.selectedId).toBe(null);
    expect(window.history.state?.eaInboxNav?.selectedId ?? null).toBe(null);
  });
});
