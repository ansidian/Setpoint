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
    let importCount = 0;
    const importFn = () => { importCount += 1; return Promise.resolve(); };
    vi.stubGlobal("requestIdleCallback", vi.fn());

    renderHook(() => useWarmImport(importFn, { enabled: false }));

    act(() => {
      vi.runAllTimers();
    });
    expect(importCount).toBe(0);
  });

  it("warms the import once when idle by default", () => {
    let importCount = 0;
    const importFn = () => { importCount += 1; return Promise.resolve(); };
    vi.stubGlobal("requestIdleCallback", vi.fn((callback) => setTimeout(callback, 0)));
    vi.stubGlobal("cancelIdleCallback", vi.fn((handle) => clearTimeout(handle)));

    renderHook(() => useWarmImport(importFn));

    expect(importCount).toBe(0);
    act(() => {
      vi.runAllTimers();
    });
    expect(importCount).toBe(1);
  });

  it("does not warm after unmounting before idle", () => {
    let importCount = 0;
    const importFn = () => { importCount += 1; return Promise.resolve(); };
    vi.stubGlobal("requestIdleCallback", vi.fn((callback) => setTimeout(callback, 0)));
    vi.stubGlobal("cancelIdleCallback", vi.fn((handle) => clearTimeout(handle)));

    const { unmount } = renderHook(() => useWarmImport(importFn, { enabled: true }));
    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(importCount).toBe(0);
  });
});
