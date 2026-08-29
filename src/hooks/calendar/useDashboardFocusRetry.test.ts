import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useDashboardFocusRetry from "./useDashboardFocusRetry";
import type { DashboardFocusRetryStatus } from "./useDashboardFocusRetry";

function attachmentFixture(statuses: DashboardFocusRetryStatus[] | DashboardFocusRetryStatus) {
  const queue = Array.isArray(statuses) ? [...statuses] : null;
  const state = {
    attempts: 0,
    giveUps: 0,
    lastTarget: null as { id: string } | null,
  };
  return {
    state,
    attempt(target: { id: string }) {
      state.attempts += 1;
      state.lastTarget = target;
      return queue?.shift() ?? (statuses as DashboardFocusRetryStatus);
    },
    onGiveUp() { state.giveUps += 1; },
  };
}

describe("useDashboardFocusRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-attempts on the retry interval until the attach succeeds", () => {
    const attachment = attachmentFixture(["retry", "retry", "done"]);
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attachment.state.attempts).toBe(1);

    vi.advanceTimersByTime(250);
    expect(attachment.state.attempts).toBe(2);

    vi.advanceTimersByTime(250);
    expect(attachment.state.attempts).toBe(3);

    // "done" stops the loop: no further attempts are scheduled.
    vi.advanceTimersByTime(250);
    expect(attachment.state.attempts).toBe(3);
  });

  it("gives up after the maximum number of attempts and reports it once", () => {
    const attachment = attachmentFixture("retry");
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, onGiveUp: attachment.onGiveUp, intervalMs: 250, maxAttempts: 3 }),
    );

    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);

    // One initial attempt + maxAttempts retries, then give up.
    expect(attachment.state).toMatchObject({ attempts: 4, giveUps: 1 });

    // The loop is fully stopped: no further attempts or give-up calls.
    vi.advanceTimersByTime(250 * 10);
    expect(attachment.state).toMatchObject({ attempts: 4, giveUps: 1 });
  });

  it("stops without retrying or giving up when the attempt aborts", () => {
    const attachment = attachmentFixture("abort");
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, onGiveUp: attachment.onGiveUp, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);

    expect(attachment.state).toMatchObject({ attempts: 1, giveUps: 0 });
  });

  it("cancels an in-flight retry when focus is cancelled", () => {
    const attachment = attachmentFixture("retry");
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attachment.state.attempts).toBe(1);

    result.current.cancelFocus();
    vi.advanceTimersByTime(250 * 10);

    expect(attachment.state.attempts).toBe(1);
  });

  it("clears the in-flight retry on unmount", () => {
    const attachment = attachmentFixture("retry");
    const { result, unmount } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, intervalMs: 250 }),
    );

    result.current.retryFocus({ id: "task-1" });
    expect(attachment.state.attempts).toBe(1);

    unmount();
    vi.advanceTimersByTime(250 * 10);

    expect(attachment.state.attempts).toBe(1);
  });

  it("restarts the attempt count when a new focus is requested", () => {
    const attachment = attachmentFixture("retry");
    const { result } = renderHook(() =>
      useDashboardFocusRetry({ attempt: attachment.attempt, intervalMs: 250, maxAttempts: 2 }),
    );

    // First session burns its budget: 1 initial + 2 retries = 3 attempts.
    result.current.retryFocus({ id: "task-1" });
    vi.advanceTimersByTime(250 * 10);
    expect(attachment.state.attempts).toBe(3);

    // A fresh request cancels the (already-finished) session and starts over.
    result.current.retryFocus({ id: "task-2" });
    vi.advanceTimersByTime(250 * 10);
    expect(attachment.state).toMatchObject({ attempts: 6, lastTarget: { id: "task-2" } });
  });
});
