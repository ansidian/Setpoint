import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useAutoRefresh from "./useAutoRefresh";

describe("useAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs quick refresh when the window regains focus after the cooldown", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: new Date("2026-05-04T11:54:59.000Z").getTime(),
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));

    expect(onQuickRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not double refresh when focus and visibility events arrive together", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: new Date("2026-05-04T11:54:59.000Z").getTime(),
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onQuickRefresh).toHaveBeenCalledTimes(1);
  });
});
