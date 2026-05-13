import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAnalyticsBackdropSnapshot } from "./analyticsBackdropSnapshot.js";
import { usePreparedBackdropSnapshot } from "./usePreparedBackdropSnapshot.js";

vi.mock("./analyticsBackdropSnapshot.js", () => ({
  captureAnalyticsBackdropSnapshot: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,current-backdrop",
  })),
  prewarmAnalyticsBackdropCapture: vi.fn(),
}));

describe("usePreparedBackdropSnapshot", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("can publish a current snapshot after activation when the prepared cache is missing", async () => {
    const source = document.createElement("div");
    const sourceRef = { current: source };

    const { result } = renderHook(() => usePreparedBackdropSnapshot({
      sourceRef,
      refreshing: false,
      refreshKey: "initial",
      tab: "dashboard",
    }));

    act(() => {
      result.current.activateBackdropSnapshot({ captureIfMissing: true });
    });

    await waitFor(() => {
      expect(result.current.backdropSnapshot?.dataUrl).toContain("current-backdrop");
    });
    expect(captureAnalyticsBackdropSnapshot).toHaveBeenCalledWith(source);
  });

  it("does not publish a prepared snapshot from a previous shell tab", async () => {
    captureAnalyticsBackdropSnapshot
      .mockResolvedValueOnce({ dataUrl: "data:image/jpeg;base64,inbox-backdrop" })
      .mockResolvedValueOnce({ dataUrl: "data:image/jpeg;base64,dashboard-backdrop" });
    const source = document.createElement("div");
    const sourceRef = { current: source };

    const { result, rerender } = renderHook(
      ({ tab }) => usePreparedBackdropSnapshot({
        sourceRef,
        refreshing: false,
        refreshKey: "same-data",
        tab,
      }),
      { initialProps: { tab: "inbox" } },
    );

    act(() => {
      result.current.activateBackdropSnapshot({ captureIfMissing: true });
    });

    await waitFor(() => {
      expect(result.current.backdropSnapshot?.dataUrl).toContain("inbox-backdrop");
    });

    act(() => {
      result.current.deactivateBackdropSnapshot({ delay: 0 });
    });
    rerender({ tab: "dashboard" });

    act(() => {
      result.current.activateBackdropSnapshot({ captureIfStale: true });
    });

    expect(result.current.backdropSnapshot).toBeNull();
    await waitFor(() => {
      expect(result.current.backdropSnapshot?.dataUrl).toContain("dashboard-backdrop");
    });
    expect(captureAnalyticsBackdropSnapshot).toHaveBeenCalledTimes(2);
  });
});
