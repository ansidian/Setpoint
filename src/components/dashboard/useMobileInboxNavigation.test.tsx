import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { getInboxSession, resetInboxSession, setInboxSession } from "../inbox/useInboxSessionState";
import type { DashboardTab } from "./dashboardShellModel";
import useMobileInboxNavigation from "./useMobileInboxNavigation";

// The navigation owner is the seam: exercise browser history and durable Inbox
// selection together, without rendering or mocking the reader's component tree.
function useNavigationHarness() {
  const [tab, setTab] = useState<DashboardTab>("dashboard");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const navigation = useMobileInboxNavigation({ isMobile: true, tab, setTab });
  useBrowserBackDismiss({
    enabled: overlayOpen,
    historyKey: "eaNavigationTestOverlay",
    onDismiss: () => setOverlayOpen(false),
  });
  return { tab, setTab, overlayOpen, setOverlayOpen, ...navigation };
}

describe("mobile Inbox navigation history", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    resetInboxSession();
  });
  afterEach(() => {
    resetInboxSession();
    window.history.replaceState({}, "", "/");
  });

  it.each([false, true])("opens Dashboard email selection in Inbox after browsing Snoozed (mobile: %s)", (isMobile) => {
    resetInboxSession({ collection: "snoozed" });
    const { result } = renderHook(() => useMobileInboxNavigation({ isMobile, tab: "dashboard", setTab: () => {} }));
    act(() => result.current.prepareEmailOpen("gmail-work-message-1"));
    expect(getInboxSession()).toMatchObject({ collection: "inbox", selectedId: "gmail-work-message-1" });
  });

  it("returns a Dashboard email directly home with browser Back, including repeated visits", async () => {
    const { result } = renderHook(useNavigationHarness);
    for (const id of ["first", "second"]) {
      act(() => {
        result.current.prepareEmailOpen(id);
        result.current.setTab("inbox");
      });
      expect(result.current.readerOpen).toBe(true);
      expect(result.current.readerBackLabel).toBe("Back to dashboard");
      act(() => window.history.back());
      await waitFor(() => expect(result.current.tab).toBe("dashboard"));
      expect(getInboxSession().selectedId).toBeNull();
    }
  });

  it("returns a list email to Inbox before returning home", async () => {
    const { result } = renderHook(useNavigationHarness);
    act(() => result.current.setTab("inbox"));
    act(() => setInboxSession((previous) => ({ ...previous, selectedId: "list-email" })));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.readerOpen).toBe(false));
    expect(result.current.tab).toBe("inbox");
    expect(getInboxSession().selectedId).toBeNull();
    act(() => window.history.back());
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
  });

  it("re-arms a dirty reader after Back and closes it only when the pending discard proceeds", async () => {
    const { result } = renderHook(useNavigationHarness);
    let pendingProceed: (() => void) | undefined;
    act(() => {
      result.current.prepareEmailOpen("draft-source");
      result.current.setTab("inbox");
      result.current.registerReaderBeforeClose((proceed) => { pendingProceed = proceed; return false; });
    });
    const originalToken = window.history.state.eaMobileReader;
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.eaMobileReader).not.toBe(originalToken));
    expect(getInboxSession().selectedId).toBe("draft-source");
    expect(result.current.tab).toBe("inbox");
    expect(window.history.state.eaMobileReader).toBeTruthy();
    // The same blocked entry must remain usable after the owner cancels and
    // then requests exit again; confirming must not enter the guard twice.
    const blockedToken = window.history.state.eaMobileReader;
    act(() => result.current.dismissReader());
    await waitFor(() => expect(window.history.state.eaMobileReader).not.toBe(blockedToken));
    expect(window.history.state.eaMobileReader).toBeTruthy();
    act(() => pendingProceed?.());
    await waitFor(() => expect(getInboxSession().selectedId).toBeNull());
    expect(result.current.tab).toBe("dashboard");
    expect(window.history.state.eaMobileReader).toBeUndefined();
  });

  it("does not retain a cancelled Home request or apply a stale discard to a different email", async () => {
    const { result } = renderHook(useNavigationHarness);
    let pendingProceed: (() => void) | undefined;
    act(() => result.current.setTab("inbox"));
    act(() => {
      setInboxSession((previous) => ({ ...previous, selectedId: "draft-source" }));
      result.current.registerReaderBeforeClose((proceed) => { pendingProceed = proceed; return false; });
    });
    const originalToken = window.history.state.eaMobileReader;
    act(() => result.current.returnHome());
    await waitFor(() => expect(window.history.state.eaMobileReader).not.toBe(originalToken));
    act(() => {
      result.current.registerReaderBeforeClose(null);
      setInboxSession((previous) => ({ ...previous, selectedId: "new-source" }));
    });
    act(() => pendingProceed?.());
    expect(getInboxSession().selectedId).toBe("new-source");
    act(() => result.current.dismissReader());
    await waitFor(() => expect(getInboxSession().selectedId).toBeNull());
    expect(result.current.tab).toBe("inbox");
    act(() => result.current.returnHome());
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
  });

  it("keeps the reader open when Back dismisses its nested overlay", async () => {
    const { result } = renderHook(useNavigationHarness);
    act(() => {
      result.current.prepareEmailOpen("dashboard-email");
      result.current.setTab("inbox");
    });
    act(() => result.current.setOverlayOpen(true));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.overlayOpen).toBe(false));
    expect(result.current.readerOpen).toBe(true);
    expect(getInboxSession().selectedId).toBe("dashboard-email");
    act(() => result.current.dismissReader());
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
    expect(getInboxSession().selectedId).toBeNull();
  });

  it("lets an explicit Home request unwind both owned list and reader entries", async () => {
    const { result } = renderHook(useNavigationHarness);
    act(() => result.current.setTab("inbox"));
    act(() => setInboxSession((previous) => ({ ...previous, selectedId: "list-email" })));
    act(() => result.current.returnHome());
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
    expect(getInboxSession().selectedId).toBeNull();
    expect(window.history.state.eaDashboardMobileTab).toBeUndefined();
    expect(window.history.state.eaMobileReader).toBeUndefined();
  });

  it("returns home if a mail action clears a Dashboard reader selection", async () => {
    const { result } = renderHook(useNavigationHarness);
    act(() => {
      result.current.prepareEmailOpen("dashboard-email");
      result.current.setTab("inbox");
    });
    act(() => setInboxSession((previous) => ({ ...previous, selectedId: null })));
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
    await waitFor(() => expect(window.history.state.eaMobileReader).toBeUndefined());
  });

  it.each([false, true])("preserves the source reader when closing a foreground route after mobile resize (already mobile: %s)", async (alreadyMobile) => {
    setInboxSession(previous => ({ ...previous, selectedId: "source-receipt" }));
    const { result, rerender } = renderHook(({ isMobile, foregroundOpen }) => {
      const [tab, setTab] = useState<DashboardTab>("inbox");
      return { tab, ...useMobileInboxNavigation({ isMobile, foregroundOpen, tab, setTab }) };
    }, { initialProps: { isMobile: alreadyMobile, foregroundOpen: false } });
    const originalToken = window.history.state.eaMobileReader;
    act(() => window.history.pushState({ idx: 1, key: "settings" }, "", "/settings?tab=finance"));
    rerender({ isMobile: true, foregroundOpen: true });
    // Closing Settings must cross exactly its route entry. Resizing cannot add
    // reader/list entries at the Settings URL or dismiss the underlying source.
    expect(window.history.state).toEqual({ idx: 1, key: "settings" });
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(getInboxSession().selectedId).toBe("source-receipt");
    expect(result.current.tab).toBe("inbox");
    if (alreadyMobile) expect(window.history.state.eaMobileReader).toBe(originalToken);
    rerender({ isMobile: true, foregroundOpen: false });
    expect(result.current.readerOpen).toBe(true);
    act(() => result.current.dismissReader());
    await waitFor(() => expect(getInboxSession().selectedId).toBeNull());
    expect(result.current.tab).toBe("inbox");
    act(() => result.current.returnHome());
    await waitFor(() => expect(result.current.tab).toBe("dashboard"));
  });
});
