import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useMotionPresence from "./useMotionPresence";

afterEach(() => vi.useRealTimers());

describe("useMotionPresence", () => {
  it("retains a closing surface for its exit window and cancels removal when reopened", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ visible }) => useMotionPresence(visible, 180),
      { initialProps: { visible: true } },
    );

    rerender({ visible: false });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(100));
    rerender({ visible: true });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);

    rerender({ visible: false });
    act(() => vi.advanceTimersByTime(180));
    expect(result.current).toBe(false);
  });
});
