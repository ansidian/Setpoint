import type {
  CurrentDashboardEvent,
  CurrentDashboardEventInput,
} from "../../shared/types/dashboard.ts";

type CurrentDashboardEventListener = (event: CurrentDashboardEvent) => void;

const subscribersByUser = new Map<string, Set<CurrentDashboardEventListener>>();

function listenerSetFor(userId: string): Set<CurrentDashboardEventListener> {
  let listeners = subscribersByUser.get(userId);
  if (!listeners) {
    listeners = new Set();
    subscribersByUser.set(userId, listeners);
  }
  return listeners;
}

function normalizeEvent(event: CurrentDashboardEventInput = {}): CurrentDashboardEvent {
  const normalized: CurrentDashboardEvent = {
    type: event.type || "dashboard_current_changed",
    source: event.source || "unknown",
    reason: event.reason || "changed",
    state: event.state || "current",
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
  if (event.details && typeof event.details === "object" && !Array.isArray(event.details)) {
    normalized.details = { ...event.details };
  }
  return normalized;
}

export function subscribeCurrentDashboardEvents(
  userId: string | undefined,
  listener: CurrentDashboardEventListener,
): () => void {
  if (!userId || typeof listener !== "function") return () => {};
  const listeners = listenerSetFor(userId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribersByUser.delete(userId);
  };
}

export function publishCurrentDashboardEvent(
  userId: string | undefined,
  event: CurrentDashboardEventInput,
): CurrentDashboardEvent {
  const normalized = normalizeEvent(event);
  if (!userId) return normalized;
  const listeners = subscribersByUser.get(userId);
  if (!listeners) return normalized;
  for (const listener of Array.from(listeners)) {
    try {
      listener(normalized);
    } catch (err) {
      console.error("[Dashboard] current event listener failed:", err instanceof Error ? err.message : String(err));
    }
  }
  return normalized;
}

export function formatCurrentDashboardSse(event: CurrentDashboardEvent): string {
  return `event: dashboard-current-changed\ndata: ${JSON.stringify(event)}\n\n`;
}

export function __resetCurrentDashboardEventsForTests() {
  subscribersByUser.clear();
}
