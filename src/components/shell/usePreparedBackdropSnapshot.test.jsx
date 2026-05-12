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
});
