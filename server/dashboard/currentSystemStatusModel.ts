// Pure provider-health -> systemStatus projection lifted from current-service.ts.
// providerHealth -> { state, sources, generatedAt }. No DB/IO.
import type { BillsMirrorHealth } from "../../shared/types/bills.ts";
import type {
  CurrentDashboardDataHealth,
  CurrentDashboardHealthState,
  CurrentDashboardProviderHealth,
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
}

function currentDataMessage(state: CurrentDashboardDataHealth["state"]): string {
  if (state === "current") return "Current dashboard data is usable.";
  if (state === "degraded") return "Some current dashboard data needs attention.";
  return "Some current dashboard data is unavailable.";
}

function todoistMessage(health: SystemStatusProviderHealthInput["todoist"]): string {
  if (health?.configured === false || health?.state === "unconfigured") return "Todoist is not configured.";
  if (health.state === "current") return "Todoist mirror is current.";
  if (health.state === "syncing") return "Todoist mirror is syncing.";
  if (health.state === "needs_sync" || health.state === "stale") return "Todoist mirror needs sync.";
  if (health.state === "degraded") return "Todoist mirror checks are degraded.";
  return "Todoist mirror is unavailable.";
}

function billsMessage(health: SystemStatusProviderHealthInput["bills"]): string {
  if (health?.configured === false || health?.state === "unconfigured") return "Bills mirror is not configured.";
  if (health?.state === "current") return "Bills mirror is current.";
  if (health?.state === "refreshing" || health?.state === "syncing") return "Bills mirror is syncing.";
  if (health?.state === "needs_sync" || health?.state === "stale") return "Bills mirror needs sync.";
  if (health?.state === "degraded") return "Bills mirror checks are degraded.";
  return "Bills mirror is unavailable.";
}

function summarizeSystemState(sources: CurrentDashboardSystemSource[]): CurrentDashboardSystemStatus["state"] {
  const configuredSources = sources.filter((source) => source.state !== "unconfigured" && source.severity !== "none");
  const severities = configuredSources.map((source) => source.severity);
  if (severities.includes("error")) return "unavailable";
  if (severities.includes("warning") && configuredSources.some((source) => source.state === "needs_sync")) return "needs_sync";
  if (severities.includes("warning")) return "degraded";
  return "current";
}

export function composeSystemStatus(
  providerHealth: SystemStatusProviderHealthInput,
  { generatedAt = new Date().toISOString() }: { generatedAt?: string } = {},
): CurrentDashboardSystemStatus {
  const todoistState = providerHealth.todoist?.state || "unavailable";
  const billsState = providerHealth.bills?.state || "unavailable";
  const reauthAccounts = providerHealth.reauth?.accounts || [];
  const sources: CurrentDashboardSystemSource[] = [
    {
      key: "currentData",
      label: "Current data",
      state: providerHealth.currentData.state,
      severity: providerHealth.currentData.state === "unavailable"
        ? "error"
        : providerHealth.currentData.state === "degraded"
          ? "warning"
          : "none",
      lastSuccessAt: providerHealth.currentData.lastSuccessAt || null,
      message: currentDataMessage(providerHealth.currentData.state),
    },
    {
      key: "todoist",
      label: "Todoist",
      state: (todoistState === "stale" ? "needs_sync" : todoistState) as CurrentDashboardHealthState,
      severity: providerHealth.todoist?.severity || (
        todoistState === "unavailable" ? "error" : todoistState === "syncing" ? "info" : "none"
      ),
      lastSuccessAt: providerHealth.todoist?.lastSuccessAt || null,
      message: todoistMessage(providerHealth.todoist),
    },
    {
      key: "bills",
      label: "Bills",
      state: (billsState === "stale" ? "needs_sync" : billsState) as CurrentDashboardHealthState,
      severity: providerHealth.bills.severity || (
        billsState === "unavailable" ? "error"
          : billsState === "needs_sync" || billsState === "degraded" || billsState === "stale" ? "warning"
            : billsState === "refreshing" || billsState === "syncing" ? "info"
              : "none"
      ),
      lastSuccessAt: providerHealth.bills?.lastSuccessAt || null,
      message: billsMessage(providerHealth.bills),
    },
    ...reauthAccounts.map((account): CurrentDashboardSystemSource => ({
      key: "reauth:" + account.id,
      label: "Gmail (" + String(account.email) + ")",
      state: "needs_reauth",
      severity: "error",
      lastSuccessAt: null,
      message: "Authorization revoked — reconnect this Google account in Settings.",
    })),
    ...(providerHealth.reauth?.todoist
      ? [{
          key: "reauth:todoist",
          label: "Todoist",
          state: "needs_reauth",
          severity: "error",
          lastSuccessAt: null,
          message: "Authorization revoked — reconnect Todoist in Settings.",
        } satisfies CurrentDashboardSystemSource]
      : []),
  ];

  return {
    state: summarizeSystemState(sources),
    sources,
    generatedAt,
  };
}
