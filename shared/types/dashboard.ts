import type { BillsMirrorHealth } from "./bills.ts";
import type { ActualBillOccurrence } from "./actual.ts";
import type { NormalizedCalendarEvent } from "./calendar.ts";
import type { ActiveSnapshotView } from "./snapshots.ts";
import type { DeadlinePayload } from "./tasks.ts";
import type { TodoistMirrorHealth } from "./tasks.ts";

export const CURRENT_DASHBOARD_CACHE_KEYS = [
  "weather_current",
  "calendar_current",
  "deadlines_current",
  "bills_current",
] as const;

export type CurrentDashboardCacheKey = typeof CURRENT_DASHBOARD_CACHE_KEYS[number];
export type CurrentDashboardRefreshKey = CurrentDashboardCacheKey | "active_snapshot";
export type CurrentDashboardRefreshMode = "passive" | "manual" | "force";
export type CurrentDashboardHealthState =
  | "current"
  | "refreshing"
  | "syncing"
  | "needs_sync"
  | "stale"
  | "degraded"
  | "unavailable"
  | "unconfigured"
  | "needs_reauth";
export type CurrentDashboardSeverity = "none" | "info" | "warning" | "error";
export interface CurrentDashboardCacheRow extends Record<string, unknown> {
  user_id?: string;
  cache_key?: CurrentDashboardCacheKey;
  payload_json?: string | null;
  fetched_at?: string | null;
  expires_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  refresh_started_at?: string | null;
  last_refresh_failed_at?: string | null;
  last_refresh_error?: string | null;
  refresh_failure_count?: string | number | bigint | null;
}

export type CurrentDashboardCacheRows = Partial<Record<CurrentDashboardCacheKey, CurrentDashboardCacheRow>>;

export interface CurrentDashboardSourceHealth {
  key: CurrentDashboardCacheKey;
  state: CurrentDashboardHealthState;
  severity: CurrentDashboardSeverity;
  fetchedAt: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
  failedAt: string | null;
  failureCount: number;
  refreshStartedAt: string | null;
}

export interface CurrentDashboardDataHealth {
  state: "current" | "degraded" | "unavailable";
  lastSuccessAt: string | null;
  sources: CurrentDashboardSourceHealth[];
}

export interface CurrentDashboardRefreshEntry {
  key: CurrentDashboardRefreshKey;
  reason: string;
}

export interface CurrentDashboardRefreshPlan {
  scheduled: CurrentDashboardRefreshEntry[];
  skipped: CurrentDashboardRefreshEntry[];
}

export interface CurrentDashboardRefresh extends CurrentDashboardRefreshPlan {
  mode: CurrentDashboardRefreshMode;
}

export interface CurrentDashboardReauthHealth {
  accounts: Array<{ id: unknown; email: unknown; type?: unknown }>;
  todoist: boolean;
}

export interface CurrentDashboardProviderHealth extends Record<string, unknown> {
  currentData: CurrentDashboardDataHealth;
  todoist: TodoistMirrorHealth;
  bills: BillsMirrorHealth;
  activeSnapshot?: {
    state?: string;
    processing?: { active?: boolean };
    [key: string]: unknown;
  } | null;
  reauth?: CurrentDashboardReauthHealth;
}

export interface CurrentDashboardWeather extends Record<string, unknown> {
  temp?: number;
  icon?: string;
}

export interface CurrentDashboardSystemSource {
  key: string;
  label: string;
  state: CurrentDashboardHealthState;
  severity: CurrentDashboardSeverity;
  lastSuccessAt: string | null;
  message: string;
}

export interface CurrentDashboardSystemStatus {
  state: "current" | "needs_sync" | "degraded" | "unavailable";
  sources: CurrentDashboardSystemSource[];
  generatedAt: string;
}

export interface CurrentDashboardEvent extends Record<string, unknown> {
  type: string;
  source: string;
  reason: string;
  state: string;
  occurredAt: string;
  details?: Record<string, unknown>;
}

export interface CurrentDashboardEventInput extends Record<string, unknown> {
  type?: string;
  source?: string;
  reason?: string;
  state?: string;
  occurredAt?: string;
  details?: Record<string, unknown>;
}

export interface CurrentDashboardResponse extends Record<string, unknown> {
  weather: CurrentDashboardWeather | null;
  calendar: NormalizedCalendarEvent[];
  deadlines: DeadlinePayload;
  bills: ActualBillOccurrence[];
  allSchedules: ActualBillOccurrence[];
  payeeMap: Record<string, string>;
  actualConfigured: boolean;
  actualBudgetUrl: string | null;
  billsSyncHealth: BillsMirrorHealth | null;
  activeSnapshot: ActiveSnapshotView;
  providerHealth: CurrentDashboardProviderHealth;
  systemStatus: CurrentDashboardSystemStatus;
  refresh: CurrentDashboardRefresh;
  fetchedAt: string;
  contentKey: string | null;
}

export interface CurrentDashboardHealthResponse {
  providerHealth: CurrentDashboardProviderHealth;
  systemStatus: CurrentDashboardSystemStatus;
  fetchedAt: string;
}
