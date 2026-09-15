import type { CurrentDashboardCacheKey, CurrentDashboardSystemSource } from "../../../shared/types/dashboard";

export interface SystemStatusSourceView {
  key?: string;
  label?: string;
  state?: string;
  message?: string;
  lastSuccessAt?: string | null;
  expiresAt?: string | null;
  action?: CurrentDashboardSystemSource["action"];
  retrySource?: CurrentDashboardCacheKey;
  refreshStartedAt?: string | null;
  /** Presentation-only email group; original account health remains independent. */
  accounts?: SystemStatusSourceView[];
}
export interface SystemStatusRetryProps {
  onRetrySource?: (source: CurrentDashboardCacheKey) => unknown;
  sourceRetry?: { source: CurrentDashboardCacheKey; state: "pending" | "success" | "error"; message?: string } | null;
}

export function sourceRefreshActive(source: SystemStatusSourceView): boolean {
  const started = Date.parse(source.refreshStartedAt || "");
  return Number.isFinite(started) && Date.now() - started < 120_000;
}

export interface SystemStatusView {
  state?: string;
  sources?: SystemStatusSourceView[];
  generatedAt?: string;
}

export const STATE_COPY = {
  current: "Up to date", checking: "Checking", refreshing: "Updating", syncing: "Syncing",
  needs_sync: "Update due", degraded: "Needs attention", unavailable: "Unavailable",
  needs_reauth: "Reconnect", unconfigured: "Not connected",
};
export type StatusState = keyof typeof STATE_COPY;
export const STATE_COLOR: Record<StatusState, string> = {
  current: "var(--sp-green)", checking: "var(--sp-subtext)", refreshing: "var(--sp-blue)",
  syncing: "var(--sp-blue)", needs_sync: "var(--sp-cream)", degraded: "var(--sp-cream)",
  unavailable: "var(--sp-rose)", needs_reauth: "var(--sp-rose)", unconfigured: "var(--sp-subtext)",
};
export const UNKNOWN_STATUS: SystemStatusView = {
  state: "checking",
  sources: [{ key: "system", label: "System status", state: "checking", message: "Waiting for the latest system status…" }],
};
export function normalizeState(state: string | null | undefined): StatusState {
  if (state === "stale") return "needs_sync";
  return state && Object.prototype.hasOwnProperty.call(STATE_COPY, state) ? state as StatusState : "unavailable";
}
export function isAttentionState(state: StatusState): boolean {
  return state === "needs_sync" || state === "degraded" || state === "unavailable" || state === "needs_reauth";
}
export function isBusyState(state: StatusState): boolean {
  return state === "refreshing" || state === "syncing" || state === "checking";
}
export function systemState(status: SystemStatusView): StatusState {
  return status.sources?.length && status.sources.every((source) => source.state === "unconfigured")
    ? "unconfigured" : normalizeState(status.state);
}
/** Group only after browser freshness projection so each account keeps its deadline. */
export function groupEmailSources(sources: SystemStatusSourceView[]): SystemStatusSourceView[] {
  const accounts = sources.filter((source) => source.key?.startsWith("email:"));
  if (!accounts.length) return sources;
  const priority: Record<StatusState, number> = {
    needs_reauth: 9, unavailable: 8, degraded: 7, needs_sync: 6,
    checking: 5, refreshing: 4, syncing: 3, current: 2, unconfigured: 1,
  };
  const ordered = [...accounts].sort((a, b) => priority[normalizeState(b.state)] - priority[normalizeState(a.state)]);
  const state = normalizeState(ordered[0]!.state);
  const attention = ordered.filter((account) => isAttentionState(normalizeState(account.state)));
  const count = accounts.length;
  const group: SystemStatusSourceView = {
    key: "email", label: "Email", state, accounts: attention,
    message: `${count} ${count === 1 ? "account" : "accounts"}${attention.length ? ` · ${attention.length} need${attention.length === 1 ? "s" : ""} attention` : ""}`,
  };
  let inserted = false;
  return sources.flatMap((source) => {
    if (!source.key?.startsWith("email:")) return [source];
    if (inserted) return [];
    inserted = true;
    return [group];
  });
}

export function statusSummary(status: SystemStatusView): string {
  const attention = groupEmailSources(status.sources || []).filter((source) => isAttentionState(normalizeState(source.state))).length;
  if (attention) return `${attention} ${attention === 1 ? "source needs" : "sources need"} attention`;
  if (status.sources?.length && status.sources.every((source) => source.state === "unconfigured")) return "No connected sources";
  const state = normalizeState(status.state);
  if (isBusyState(state)) return state === "checking" ? "Checking system status…" : "Checking for updates…";
  return state === "current" ? "Connected sources are up to date" : STATE_COPY[state];
}
export function relativeTimestamp(value: string | null | undefined, now = Date.now()): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Last update unknown";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes === 0) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
