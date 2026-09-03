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
});
