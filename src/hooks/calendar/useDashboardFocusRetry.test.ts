import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useDashboardFocusRetry from "./useDashboardFocusRetry";
import type { DashboardFocusRetryStatus } from "./useDashboardFocusRetry";

describe("useDashboardFocusRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the attach attempt immediately when focus is requested", () => {
    const attempt = vi.fn(() => "done" as const);
    const { result } = renderHook(() => useDashboardFocusRetry({ attempt }));

    result.current.retryFocus({ id: "task-1" });

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith({ id: "task-1" });
  });

  it("re-attempts on the retry interval until the attach succeeds", () => {
    const attempt = vi
      .fn<() => DashboardFocusRetryStatus>()
      .mockReturnValueOnce("retry")
      .mockReturnValueOnce("retry")
      .mockReturnValueOnce("done");
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attempt).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(attempt).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(attempt).toHaveBeenCalledTimes(3);

    // "done" stops the loop: no further attempts are scheduled.
    vi.advanceTimersByTime(250);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("gives up after the maximum number of attempts and reports it once", () => {
    const attempt = vi.fn(() => "retry" as const);
    const onGiveUp = vi.fn();
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt, onGiveUp, intervalMs: 250, maxAttempts: 3 }),
    );

    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);

    // One initial attempt + maxAttempts retries, then give up.
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    // The loop is fully stopped: no further attempts or give-up calls.
    vi.advanceTimersByTime(250 * 10);
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("stops without retrying or giving up when the attempt aborts", () => {
    const attempt = vi.fn(() => "abort" as const);
    const onGiveUp = vi.fn();
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt, onGiveUp, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("cancels an in-flight retry when focus is cancelled", () => {
    const attempt = vi.fn(() => "retry" as const);
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attempt).toHaveBeenCalledTimes(1);

    result.current.cancelFocus();
    vi.advanceTimersByTime(250 * 10);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight retry on unmount", () => {
    const attempt = vi.fn(() => "retry" as const);
    const { result, unmount } = renderHook(() =>
      useDashboardFocusRetry({ attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attempt).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(250 * 10);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("restarts the attempt count when a new focus is requested", () => {
    const attempt = vi.fn(() => "retry" as const);
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt, intervalMs: 250, maxAttempts: 2 }),
    );

    // First session burns its budget: 1 initial + 2 retries = 3 attempts.
    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);
    expect(attempt).toHaveBeenCalledTimes(3);

    // A fresh request cancels the (already-finished) session and starts over.
    result.current.retryFocus({ id: "task-2" });
    vi.advanceTimersByTime(250 * 10);
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(attempt).toHaveBeenLastCalledWith({ id: "task-2" });
  });
});
