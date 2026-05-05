import { describe, expect, it, vi } from "vitest";

const {
  formatCurrentDashboardSse,
  publishCurrentDashboardEvent,
  subscribeCurrentDashboardEvents,
} = await import("./current-events.js");

describe("current dashboard events", () => {
  it("publishes normalized refetch events to subscribers for the same user", () => {
    const listener = vi.fn();
    const otherUserListener = vi.fn();

    const unsubscribe = subscribeCurrentDashboardEvents("u1", listener);
    subscribeCurrentDashboardEvents("u2", otherUserListener);

    const event = publishCurrentDashboardEvent("u1", {
      source: "todoist",
      reason: "webhook_received",
      state: "needs_sync",
      occurredAt: "2026-05-05T00:00:00.000Z",
    });

    expect(event).toEqual({
      type: "dashboard_current_changed",
      source: "todoist",
      reason: "webhook_received",
      state: "needs_sync",
      occurredAt: "2026-05-05T00:00:00.000Z",
    });
    expect(listener).toHaveBeenCalledWith(event);
    expect(otherUserListener).not.toHaveBeenCalled();

    unsubscribe();
    publishCurrentDashboardEvent("u1", {
      source: "todoist",
      reason: "sync_settled",
      state: "current",
      occurredAt: "2026-05-05T00:00:01.000Z",
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("formats dashboard-current SSE events as refetch hints", () => {
    expect(formatCurrentDashboardSse({
      type: "dashboard_current_changed",
      source: "todoist",
      reason: "sync_settled",
      state: "current",
      occurredAt: "2026-05-05T00:00:01.000Z",
    })).toBe(
      "event: dashboard-current-changed\n"
      + "data: {\"type\":\"dashboard_current_changed\",\"source\":\"todoist\",\"reason\":\"sync_settled\",\"state\":\"current\",\"occurredAt\":\"2026-05-05T00:00:01.000Z\"}\n\n",
    );
  });
});
