import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useAutoRefresh from "./useAutoRefresh";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const NOW = new Date("2026-05-04T12:00:00.000Z").getTime();

// useAutoRefresh reads document.visibilityState directly. happy-dom defaults to
// "visible"; redefine it (same pattern useCurrentDashboard.test.js uses for
// document.hidden) and restore "visible" after each test so the shared document
// does not leak between cases.
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

describe("useAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("runs quick refresh when the window regains focus after the cooldown", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      // Last refresh just over 5 min ago → outside the cooldown window.
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));

    expect(onQuickRefresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh on focus within the cooldown window", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      // Last refresh 1 second ago → well inside the 5-min cooldown.
      lastQuickRefreshAt: NOW - 1000,
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));

    expect(onQuickRefresh).not.toHaveBeenCalled();
  });

  it("distinguishes cooldown from dedup: a recent refresh suppresses focus, an old one does not", () => {
    // Recent timestamp → suppressed. This is the case the old test missed:
    // it always used an old timestamp, so it would pass even with no cooldown.
    const recent = vi.fn();
    const recentHook = renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - 1000,
      onQuickRefresh: recent,
    }));
    window.dispatchEvent(new Event("focus"));
    expect(recent).not.toHaveBeenCalled();
    recentHook.unmount();

    // Old timestamp → allowed.
    const old = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh: old,
    }));
    window.dispatchEvent(new Event("focus"));
    expect(old).toHaveBeenCalledTimes(1);
  });

  it("treats the most recent trigger as the cooldown anchor for the next focus", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    // First focus is outside the cooldown → refreshes and resets the anchor to now.
    window.dispatchEvent(new Event("focus"));
    expect(onQuickRefresh).toHaveBeenCalledTimes(1);

    // A second focus shortly after is now inside the freshly-set cooldown.
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("focus"));
    expect(onQuickRefresh).toHaveBeenCalledTimes(1);

    // Once enough time passes to clear the cooldown, focus refreshes again.
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    window.dispatchEvent(new Event("focus"));
    expect(onQuickRefresh).toHaveBeenCalledTimes(2);
  });

  it("fires the quick refresh on the 5-minute interval tick", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW,
      onQuickRefresh,
    }));

    // The interval tick is not cooldown-gated, so it fires even though the last
    // refresh was "now" — just before the tick.
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    expect(onQuickRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    expect(onQuickRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not double refresh when focus and visibility events arrive together", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onQuickRefresh).toHaveBeenCalledTimes(1);
  });

  it("suppresses focus refresh while the tab is hidden", () => {
    setVisibility("hidden");
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      // Outside cooldown — so the only thing that can suppress it is hidden state.
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));

    expect(onQuickRefresh).not.toHaveBeenCalled();
  });

  it("suppresses the interval tick while the tab is hidden", () => {
    setVisibility("hidden");
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3);

    expect(onQuickRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh on a visibilitychange that resolves to hidden", () => {
    setVisibility("hidden");
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    document.dispatchEvent(new Event("visibilitychange"));

    expect(onQuickRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh on any trigger when disabled", () => {
    const onQuickRefresh = vi.fn();
    renderHook(() => useAutoRefresh({
      disabled: true,
      lastQuickRefreshAt: NOW - REFRESH_INTERVAL_MS - 1000,
      onQuickRefresh,
    }));

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 2);

    expect(onQuickRefresh).not.toHaveBeenCalled();
  });
});
