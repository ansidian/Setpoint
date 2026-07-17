import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useWarmImport from "./useWarmImport";

describe("useWarmImport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not warm the import when disabled", () => {
    const importFn = vi.fn(() => Promise.resolve());
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);

    renderHook(() => useWarmImport(importFn, { enabled: false }));

    expect(requestIdleCallback).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(importFn).not.toHaveBeenCalled();
  });

  it("warms the import once when idle by default", () => {
    const importFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("requestIdleCallback", vi.fn((callback) => setTimeout(callback, 0)));
    vi.stubGlobal("cancelIdleCallback", vi.fn((handle) => clearTimeout(handle)));

    renderHook(() => useWarmImport(importFn));

    expect(importFn).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it("does not warm after unmounting before idle", () => {
    const importFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("requestIdleCallback", vi.fn((callback) => setTimeout(callback, 0)));
    vi.stubGlobal("cancelIdleCallback", vi.fn((handle) => clearTimeout(handle)));

    const { unmount } = renderHook(() => useWarmImport(importFn, { enabled: true }));
    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(importFn).not.toHaveBeenCalled();
  });
});
