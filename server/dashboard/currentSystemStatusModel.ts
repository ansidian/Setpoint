// Pure domain/cache-health -> user-facing system status. No DB/IO.
import type { BillsMirrorHealth } from "../../shared/types/bills.ts";
import type {
  CurrentDashboardDataHealth,
  CurrentDashboardCacheKey,
  CurrentDashboardHealthState,
  CurrentDashboardProviderHealth,
  CurrentDashboardSourceHealth,
  CurrentDashboardSystemSource,
  CurrentDashboardSystemStatus,
} from "../../shared/types/dashboard.ts";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";

interface SystemStatusProviderHealthInput {
  currentData: Pick<CurrentDashboardDataHealth, "state"> & Partial<CurrentDashboardDataHealth>;
  todoist: Pick<TodoistMirrorHealth, "state"> & Partial<TodoistMirrorHealth>;
  bills: Pick<BillsMirrorHealth, "state"> & Partial<BillsMirrorHealth> & {
    severity?: CurrentDashboardSystemSource["severity"];
  };
  reauth?: CurrentDashboardProviderHealth["reauth"];
  configured?: CurrentDashboardProviderHealth["configured"];
}

type HealthEvidence = Pick<CurrentDashboardSystemSource, "state" | "severity" | "lastSuccessAt">;
const STATE_PRIORITY: Record<CurrentDashboardHealthState, number> = {
  needs_reauth: 7, unavailable: 6, degraded: 5, needs_sync: 4, stale: 4,
  refreshing: 3, syncing: 3, current: 1, unconfigured: 0,
};

function mirrorEvidence(health: SystemStatusProviderHealthInput["todoist"] | SystemStatusProviderHealthInput["bills"]): HealthEvidence {
  const failedChecks = "failedCheckCount" in health && Number(health.failedCheckCount) > 0 && health.lastCheckFailedAt;
  // A local mirror read can succeed after its provider refresh failed. Preserve
  // that failed-check evidence, including inside Todoist's normal grace window.
  const state = failedChecks && health.state === "current" ? "degraded"
    : health.state === "stale" ? "needs_sync" : health.state as CurrentDashboardHealthState;
  return {
    state,
    severity: failedChecks && state === "degraded" ? "warning" : health.severity ?? (
      state === "unavailable" || state === "needs_reauth" ? "error"
        : state === "degraded" || state === "needs_sync" ? "warning"
          : state === "syncing" || state === "refreshing" ? "info" : "none"
    ),
    lastSuccessAt: health.lastSuccessAt ?? null,
  };
}

function sourceImpact(label: string): string {
  return label === "Calendar" ? "New or changed events may be missing."
    : label === "Tasks" ? "New tasks, due-date changes, or completions may be missing."
      : label === "Bills" ? "Schedules and payment status may be out of date."
        : label === "Weather" ? "Conditions and forecasts may be out of date."
          : "Some information may be out of date.";
}

function sourceMessage(label: string, state: CurrentDashboardHealthState, hasSavedData: boolean): string {
  if (state === "unconfigured") return `${label} is not connected.`;
  if (state === "current") return `${label} is up to date.`;
  if (state === "syncing" || state === "refreshing") return `${label} is updating.`;
  const impact = sourceImpact(label);
  if (state === "needs_sync" || state === "stale") return `${impact} Retry now to check for changes.`;
  const saved = hasSavedData ? " Saved data remains visible." : " No saved data is available yet.";
  return `${impact}${saved} Retry now, or check the connection if the problem continues.`;
}

const RETRY_SOURCES: Record<string, CurrentDashboardCacheKey> = {
  weather: "weather_current", calendar: "calendar_current", todoist: "deadlines_current", bills: "bills_current",
};

function activeRefreshStartedAt(cache: CurrentDashboardSourceHealth | undefined, mirror: SystemStatusProviderHealthInput["todoist"] | SystemStatusProviderHealthInput["bills"] | undefined, now: number): string | null {
  const timestamps = [cache?.refreshStartedAt,
    mirror && "syncStartedAt" in mirror ? mirror.syncStartedAt : null,
    mirror && "refreshStartedAt" in mirror ? mirror.refreshStartedAt : null,
  ].filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && now >= Date.parse(value) && now - Date.parse(value) < 120_000);
  return timestamps.sort()[0] ?? null;
}

function domainSource({ key, label, connection, cache, mirror, configured, now }: {
  key: string;
  label: string;
  connection: string;
  cache?: CurrentDashboardSourceHealth;
  mirror?: SystemStatusProviderHealthInput["todoist"] | SystemStatusProviderHealthInput["bills"];
  configured?: boolean;
  now: number;
}): CurrentDashboardSystemSource {
  const cacheEvidence: HealthEvidence | undefined = cache && {
    state: cache.state === "stale" ? "needs_sync" : cache.state,
    severity: cache.severity,
    lastSuccessAt: cache.fetchedAt,
  };
  const domain = mirror && mirrorEvidence(mirror);
  const disabled = configured === false || mirror?.configured === false || mirror?.state === "unconfigured";
  const evidence = disabled ? { state: "unconfigured" as const, severity: "none" as const, lastSuccessAt: null }
    : domain && (!cacheEvidence || STATE_PRIORITY[domain.state] >= STATE_PRIORITY[cacheEvidence.state]) ? domain
      : cacheEvidence ?? domain ?? { state: "unavailable" as const, severity: "error" as const, lastSuccessAt: null };
  // Freshness must not advance past either the provider mirror or the data delivered
  // to this dashboard. A recovered mirror does not refresh an older cached payload.
  const successTimes = [cache?.fetchedAt, domain?.lastSuccessAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const lastSuccessAt = disabled || cache?.fetchedAt === null || !successTimes.length ? null : new Date(Math.min(...successTimes)).toISOString();
  return {
    key, label, state: evidence.state, severity: evidence.severity, lastSuccessAt,
    expiresAt: disabled ? null : cache?.expiresAt ?? null,
    impact: sourceImpact(label),
    refreshStartedAt: disabled ? null : activeRefreshStartedAt(cache, mirror, now),
    ...(!disabled ? { retrySource: RETRY_SOURCES[key] } : {}),
    message: sourceMessage(label, evidence.state, Boolean(cache ? cache.fetchedAt : lastSuccessAt)),
    ...(evidence.state === "unconfigured" ? {
      action: { label: "Connect", href: `/settings?tab=connections#${connection}` },
    } : evidence.severity === "error" || evidence.severity === "warning" ? {
      action: { label: "Check connection", href: `/settings?tab=connections#${connection}` },
    } : {}),
  };
}

function summarizeSystemState(sources: CurrentDashboardSystemSource[]): CurrentDashboardSystemStatus["state"] {
  const enabled = sources.filter((source) => source.state !== "unconfigured");
  if (enabled.some((source) => source.severity === "error")) return "unavailable";
  if (enabled.some((source) => source.severity === "warning" && source.state !== "needs_sync")) return "degraded";
  if (enabled.some((source) => source.state === "needs_sync" || source.state === "stale")) return "needs_sync";
  if (enabled.some((source) => source.state === "syncing" || source.state === "refreshing")) return "syncing";
  return "current";
}

export function composeSystemStatus(
  providerHealth: SystemStatusProviderHealthInput,
  { generatedAt = new Date().toISOString() }: { generatedAt?: string } = {},
): CurrentDashboardSystemStatus {
  const now = Date.parse(generatedAt);
  const cacheSources = providerHealth.currentData.sources;
  const cache = (key: CurrentDashboardSourceHealth["key"]) => cacheSources?.find((source) => source.key === key);
  const sources: CurrentDashboardSystemSource[] = cacheSources ? [
    domainSource({ now, key: "weather", label: "Weather", connection: "pirate-weather", cache: cache("weather_current"), configured: providerHealth.configured?.weather }),
    domainSource({ now, key: "calendar", label: "Calendar", connection: "google-workspace", cache: cache("calendar_current"), configured: providerHealth.configured?.calendar }),
  ] : [{
    // Compatibility for callers carrying only the older aggregate contract.
    key: "currentData", label: "Current data", state: providerHealth.currentData.state,
    severity: providerHealth.currentData.state === "unavailable" ? "error" : providerHealth.currentData.state === "degraded" ? "warning" : "none",
    lastSuccessAt: providerHealth.currentData.lastSuccessAt ?? null,
    message: sourceMessage("Dashboard data", providerHealth.currentData.state, Boolean(providerHealth.currentData.lastSuccessAt)),
  }];
  sources.push(
    domainSource({ now, key: "todoist", label: "Tasks", connection: "todoist", cache: cache("deadlines_current"), mirror: providerHealth.todoist }),
    domainSource({ now, key: "bills", label: "Bills", connection: "actual-budget", cache: cache("bills_current"), mirror: providerHealth.bills }),
  );
  if (providerHealth.reauth?.todoist) {
    const tasks = sources.find((source) => source.key === "todoist")!;
    delete tasks.retrySource;
    tasks.refreshStartedAt = null;
    Object.assign(tasks, {
      state: "needs_reauth", severity: "error",
      message: "Reconnect Todoist to resume task updates.",
      action: { label: "Reconnect Todoist", href: "/settings?tab=connections#todoist" },
    });
  }
  for (const account of providerHealth.reauth?.accounts ?? []) {
    const icloud = account.type === "icloud";
    const label = icloud ? "iCloud Mail" : "Google";
    sources.push({
      key: `reauth:${account.id}`, label: `${label} (${String(account.email)})`,
      state: "needs_reauth", severity: "error", lastSuccessAt: null,
      message: icloud ? "Reconnect this iCloud account to resume email updates." : "Reconnect this Google account to resume email and calendar updates.",
      action: { label: `Reconnect ${label}`, href: `/settings?tab=connections#${icloud ? "icloud-mail" : "google-workspace"}` },
    });
  }
  return { state: summarizeSystemState(sources), sources, generatedAt };
}
