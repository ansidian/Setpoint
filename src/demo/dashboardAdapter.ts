import { createDemoApiError } from "./config.ts";
import type { DemoSeed } from "./store.ts";
import type { CurrentDashboardCacheKey } from "../../shared/types/dashboard.ts";

const RETRY_KEYS: Record<string, CurrentDashboardCacheKey> = {
  weather: "weather_current", calendar: "calendar_current", todoist: "deadlines_current", bills: "bills_current",
};

export function demoDashboardResponse(seed: DemoSeed, sourceToRefresh: unknown, method: string) {
  if (sourceToRefresh != null) {
    if (!Object.values(RETRY_KEYS).includes(sourceToRefresh as CurrentDashboardCacheKey)) {
      throw createDemoApiError("/api/dashboard/current/refresh");
    }
    const now = new Date().toISOString();
    seed.currentDashboard.systemStatus.sources = seed.currentDashboard.systemStatus.sources.map((source) =>
      RETRY_KEYS[source.key] === sourceToRefresh ? { ...source, state: "current", lastSuccessAt: now } : source);
    seed.currentDashboard.systemStatus.generatedAt = now;
    seed.currentDashboard.fetchedAt = now;
  }
  return structuredClone({
    ...seed.currentDashboard,
    systemStatus: {
      ...seed.currentDashboard.systemStatus,
      sources: seed.currentDashboard.systemStatus.sources.map((source) => ({ ...source, retrySource: RETRY_KEYS[source.key] })),
    },
    refresh: { mode: method === "POST" ? "manual" : "passive", scheduled: [], skipped: [] },
  });
}
