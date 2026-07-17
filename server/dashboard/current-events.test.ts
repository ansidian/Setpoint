import { describe, expect, it, vi } from "vitest";

const {
  formatCurrentDashboardSse,
  publishCurrentDashboardEvent,
  subscribeCurrentDashboardEvents,
} = await import("./current-events.ts");

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

  it("preserves structured event details for typed dashboard consumers", () => {
    const event = publishCurrentDashboardEvent("u1", {
      source: "email_triage",
      reason: "email_triage_finalized",
      state: "current",
      occurredAt: "2026-05-05T00:00:02.000Z",
      details: {
        triggerType: "needs_attention_finalized",
        eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
        emailId: "msg-1",
        lane: "needs_attention",
        triageSource: "strong_model",
        reason: "email_triage_finalized",
      },
    });

    expect(event).toEqual({
      type: "dashboard_current_changed",
      source: "email_triage",
      reason: "email_triage_finalized",
      state: "current",
      occurredAt: "2026-05-05T00:00:02.000Z",
      details: {
        triggerType: "needs_attention_finalized",
        eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
        emailId: "msg-1",
        lane: "needs_attention",
        triageSource: "strong_model",
        reason: "email_triage_finalized",
      },
    });
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
