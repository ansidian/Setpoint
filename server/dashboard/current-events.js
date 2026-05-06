const subscribersByUser = new Map();

function listenerSetFor(userId) {
  let listeners = subscribersByUser.get(userId);
  if (!listeners) {
    listeners = new Set();
    subscribersByUser.set(userId, listeners);
  }
  return listeners;
}

function normalizeEvent(event = {}) {
  const normalized = {
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

export function subscribeCurrentDashboardEvents(userId, listener) {
  if (!userId || typeof listener !== "function") return () => {};
  const listeners = listenerSetFor(userId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribersByUser.delete(userId);
  };
}

export function publishCurrentDashboardEvent(userId, event) {
  const normalized = normalizeEvent(event);
  const listeners = subscribersByUser.get(userId);
  if (!listeners) return normalized;
  for (const listener of Array.from(listeners)) {
    try {
      listener(normalized);
    } catch (err) {
      console.error("[Dashboard] current event listener failed:", err.message);
    }
  }
  return normalized;
}

export function formatCurrentDashboardSse(event) {
  return `event: dashboard-current-changed\ndata: ${JSON.stringify(event)}\n\n`;
}

export function __resetCurrentDashboardEventsForTests() {
  subscribersByUser.clear();
}
