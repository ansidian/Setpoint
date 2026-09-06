import type {
  CurrentDashboardSystemSource,
  CurrentDashboardSystemStatus,
} from "../../shared/types/dashboard";

export interface DashboardClientSystemStatus extends Omit<CurrentDashboardSystemStatus, "state" | "sources"> {
  state: CurrentDashboardSystemStatus["state"] | "checking";
  sources: Array<Omit<CurrentDashboardSystemSource, "state"> & { state: CurrentDashboardSystemSource["state"] | "checking" }>;
}

interface DashboardHealthObservation {
  readFailed: boolean;
  offline: boolean;
  liveUpdatesDisconnected: boolean;
  lastCheckedAt: string | null;
  now: number;
}

// Server health describes providers. Browser observations describe whether that
// evidence can still be checked; retaining saved content must not retain green.
export function projectDashboardHealth(
  status: CurrentDashboardSystemStatus | null | undefined,
  observation: DashboardHealthObservation,
): DashboardClientSystemStatus {
  const { readFailed, offline, liveUpdatesDisconnected, lastCheckedAt, now } = observation;
  const sources: DashboardClientSystemStatus["sources"] = (status?.sources || []).map((source) => {
    if (source.state !== "current" || !source.expiresAt || Date.parse(source.expiresAt) > now) return source;
    if (!Number.isFinite(Date.parse(source.expiresAt))) return source;
    return {
      ...source,
      state: "needs_sync" as const,
      severity: "info" as const,
      message: source.impact || `${source.label} is due for an update. Sync to check for changes.`,
    };
  });
  let state: DashboardClientSystemStatus["state"] = status?.state || "checking";
  if ((state === "current" || state === "syncing") && sources.some((source) => source.state === "needs_sync")) state = "needs_sync";
  if (!status || offline || readFailed || liveUpdatesDisconnected) {
    const checking = !status && !offline && !readFailed;
    const connection: DashboardClientSystemStatus["sources"][number] = {
      key: "dashboard_connection",
      label: "Connection",
      state: checking ? "checking" : status ? "degraded" : "unavailable",
      severity: checking ? "info" : status ? "warning" : "error",
      lastSuccessAt: lastCheckedAt,
      message: offline
        ? "This device is offline. Saved data remains visible; reconnect to check for changes."
        : readFailed
          ? status ? "Setpoint could not check for updates. Saved data remains visible; try syncing again."
            : "Setpoint could not load system status. Try syncing again."
          : checking
            ? "Checking the latest system status…"
            : "Live updates are interrupted. Periodic checks continue; reconnecting automatically.",
    };
    sources.unshift(connection);
    state = checking ? "checking" : !status || state === "unavailable" ? "unavailable" : "degraded";
  }
  return { state, sources, generatedAt: lastCheckedAt || status?.generatedAt || "" };
}
