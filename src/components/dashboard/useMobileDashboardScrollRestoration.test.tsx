import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useMobileDashboardScrollRestoration from "./useMobileDashboardScrollRestoration";
import type { DashboardTab } from "./dashboardShellModel";

describe("useMobileDashboardScrollRestoration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures dashboard scroll and restores it immediately and after the revealed content expands", () => {
    let nextFrame: FrameRequestCallback | null = null;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        nextFrame = callback;
        return 17;
      });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const scrollRegion = document.createElement("div");
    const { result, rerender, unmount } = renderHook(
      ({ tab }) => useMobileDashboardScrollRestoration({ isMobile: true, tab }),
      { initialProps: { tab: "dashboard" as DashboardTab } },
    );
    result.current.scrollRef.current = scrollRegion;

    scrollRegion.scrollTop = 184;
    act(() => result.current.onScroll({ currentTarget: scrollRegion } as React.UIEvent<HTMLDivElement>));
    rerender({ tab: "inbox" });
    scrollRegion.scrollTop = 0;
    rerender({ tab: "dashboard" });

    expect(scrollRegion.scrollTop).toBe(184);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    scrollRegion.scrollTop = 0;
    act(() => nextFrame?.(0));
    expect(scrollRegion.scrollTop).toBe(184);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});
