import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useMobileDashboardScrollRestoration from "./useMobileDashboardScrollRestoration.js";

describe("useMobileDashboardScrollRestoration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures dashboard scroll and restores it immediately and after the revealed content expands", () => {
    let nextFrame;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        nextFrame = callback;
        return 17;
      });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const scrollRegion = { scrollTop: 0 };
    const { result, rerender, unmount } = renderHook(
      ({ tab }) => useMobileDashboardScrollRestoration({ isMobile: true, tab }),
      { initialProps: { tab: "dashboard" } },
    );
    result.current.scrollRef.current = scrollRegion;

    act(() => result.current.onScroll({ currentTarget: { scrollTop: 184 } }));
    rerender({ tab: "inbox" });
    scrollRegion.scrollTop = 0;
    rerender({ tab: "dashboard" });

    expect(scrollRegion.scrollTop).toBe(184);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    scrollRegion.scrollTop = 0;
    act(() => nextFrame());
    expect(scrollRegion.scrollTop).toBe(184);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});
