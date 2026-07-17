// Pure refresh planning lifted from current-service.ts: given cache rows + a mode,
// decide which providers to refresh vs skip (TTL, backoff, refreshing, override,
// maintenance, manual). (rows, opts) -> { scheduled, skipped }. No DB/IO; reads the
// static CURRENT_DATA_PROVIDERS registry + pure row-health helpers.
import { CURRENT_DATA_PROVIDERS } from "./current-providers/index.ts";
import { hasUsablePayload, isRefreshTimedOut, sourceHealthForRow } from "./current-sources.ts";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardCacheRow,
  CurrentDashboardCacheRows,
  CurrentDashboardRefreshMode,
  CurrentDashboardRefreshPlan,
} from "../../shared/types/dashboard.ts";
import type { CurrentProviderContext } from "./current-types.ts";

const PASSIVE_FAILURE_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

function isFresh(row: CurrentDashboardCacheRow | undefined, now: Date = new Date()): boolean {
  if (!row?.expires_at) return false;
  return new Date(row.expires_at).getTime() > now.getTime();
}

function skippedEntry(key: CurrentDashboardCacheKey, reason: string) {
  return { key, reason };
}

export function scheduledEntry(key: CurrentDashboardCacheKey | "active_snapshot", reason: string) {
  return { key, reason };
}

function ensureScheduled(refreshPlan: CurrentDashboardRefreshPlan, key: CurrentDashboardCacheKey, reason: string): void {
  refreshPlan.skipped = refreshPlan.skipped.filter((entry) => entry.key !== key);
  if (!refreshPlan.scheduled.some((entry) => entry.key === key)) {
    refreshPlan.scheduled.push(scheduledEntry(key, reason));
  }
}

function passiveBackoffMs(failureCount: number): number {
  if (failureCount <= 1) return PASSIVE_FAILURE_BACKOFF_MS[0]!;
  if (failureCount === 2) return PASSIVE_FAILURE_BACKOFF_MS[1]!;
  return PASSIVE_FAILURE_BACKOFF_MS[2]!;
}

function isInPassiveBackoff(row: CurrentDashboardCacheRow | undefined, now: Date): boolean {
  const failedAt = row?.last_refresh_failed_at;
  const count = Number(row?.refresh_failure_count || 0);
  if (!failedAt || count <= 0) return false;
  return now.getTime() - new Date(failedAt).getTime() < passiveBackoffMs(count);
}

function refreshReasonForSource(
  key: CurrentDashboardCacheKey,
  row: CurrentDashboardCacheRow | undefined,
  mode: CurrentDashboardRefreshMode,
  now: Date,
): string | null {
  if (!row) return "missing";
  const health = sourceHealthForRow(key, row, now);
  if (!hasUsablePayload(key, row)) return "no_usable_payload";
  if (health.state === "unavailable") return "unavailable";
  if (health.state === "degraded") return mode === "manual" ? "manual_retry" : "degraded";
  if (!isFresh(row, now)) return "ttl_due";
  return null;
}

export function planCurrentDataRefresh(rows: CurrentDashboardCacheRows, {
  mode,
  now,
  force = false,
  context = {},
}: {
  mode: CurrentDashboardRefreshMode;
  now: Date;
  force?: boolean;
  context?: CurrentProviderContext;
}): CurrentDashboardRefreshPlan {
  const scheduled: CurrentDashboardRefreshPlan["scheduled"] = [];
  const skipped: CurrentDashboardRefreshPlan["skipped"] = [];
  for (const provider of CURRENT_DATA_PROVIDERS) {
    const key = provider.key;
    const row = rows[key];
    if (force) {
      scheduled.push(scheduledEntry(key, "force"));
      continue;
    }
    if (row?.status === "refreshing" || row?.refresh_started_at) {
      if (isRefreshTimedOut(row, now)) scheduled.push(scheduledEntry(key, "degraded"));
      else skipped.push(skippedEntry(key, "already_refreshing"));
      continue;
    }
    const overrideReason = provider.refreshReasonOverride?.({ row, now, context });
    if (overrideReason) {
      scheduled.push(scheduledEntry(key, overrideReason));
      continue;
    }
    const reason = refreshReasonForSource(key, row, mode, now);
    if (!reason) {
      skipped.push(skippedEntry(key, isFresh(row, now) ? "fresh" : "not_due"));
      continue;
    }
    if (mode === "passive" && isInPassiveBackoff(row, now)) {
      skipped.push(skippedEntry(key, "backoff"));
      continue;
    }
    scheduled.push(scheduledEntry(key, reason));
  }
  return { scheduled, skipped };
}

export function applyProviderPassiveSuppression(
  refreshPlan: CurrentDashboardRefreshPlan,
  rows: CurrentDashboardCacheRows,
  { now, context = {} }: { now: Date; context?: CurrentProviderContext },
): void {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.passiveSuppressReason) continue;
    const reason = provider.passiveSuppressReason({ row: rows[provider.key], now, context });
    if (!reason) continue;
    const scheduledBefore = refreshPlan.scheduled.length;
    refreshPlan.scheduled = refreshPlan.scheduled.filter((entry) => entry.key !== provider.key);
    if (refreshPlan.scheduled.length !== scheduledBefore) {
      refreshPlan.skipped.push(skippedEntry(provider.key, reason));
    }
  }
}

export function applyProviderMaintenanceRefresh(
  refreshPlan: CurrentDashboardRefreshPlan,
  rows: CurrentDashboardCacheRows,
  { forceKeys, now, context = {} }: {
    forceKeys?: Set<CurrentDashboardCacheKey>;
    now: Date;
    context?: CurrentProviderContext;
  },
): void {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.maintenanceRefreshReason) continue;
    const row = rows[provider.key];
    const reason = provider.maintenanceRefreshReason({ row, now, context });
    if (!reason) continue;
    if (isInPassiveBackoff(row, now)) continue;
    if (provider.passiveSuppressReason?.({ row, now, context })) continue;
    ensureScheduled(refreshPlan, provider.key, reason);
    forceKeys?.add(provider.key);
  }
}

export function applyProviderManualRefresh(
  refreshPlan: CurrentDashboardRefreshPlan,
  rows: CurrentDashboardCacheRows,
  { forceKeys, now, context = {} }: {
    forceKeys?: Set<CurrentDashboardCacheKey>;
    now: Date;
    context?: CurrentProviderContext;
  },
): void {
  for (const provider of CURRENT_DATA_PROVIDERS) {
    if (!provider.manualRefreshReason) continue;
    const reason = provider.manualRefreshReason({ row: rows[provider.key], now, context });
    if (!reason) continue;
    ensureScheduled(refreshPlan, provider.key, reason);
    forceKeys?.add(provider.key);
  }
}
