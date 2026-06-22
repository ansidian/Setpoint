// Pure provider-health -> systemStatus projection lifted from current-service.js.
// providerHealth -> { state, sources, generatedAt }. No DB/IO.

function currentDataMessage(state) {
  if (state === "current") return "Current dashboard data is usable.";
  if (state === "degraded") return "Some current dashboard data needs attention.";
  return "Some current dashboard data is unavailable.";
}

function todoistMessage(health) {
  if (health?.configured === false || health?.state === "unconfigured") return "Todoist is not configured.";
  if (health.state === "current") return "Todoist mirror is current.";
  if (health.state === "syncing") return "Todoist mirror is syncing.";
  if (health.state === "needs_sync" || health.state === "stale") return "Todoist mirror needs sync.";
  if (health.state === "degraded") return "Todoist mirror checks are degraded.";
  return "Todoist mirror is unavailable.";
}

function billsMessage(health) {
  if (health?.configured === false || health?.state === "unconfigured") return "Bills mirror is not configured.";
  if (health?.state === "current") return "Bills mirror is current.";
  if (health?.state === "refreshing" || health?.state === "syncing") return "Bills mirror is syncing.";
  if (health?.state === "needs_sync" || health?.state === "stale") return "Bills mirror needs sync.";
  if (health?.state === "degraded") return "Bills mirror checks are degraded.";
  return "Bills mirror is unavailable.";
}

function summarizeSystemState(sources) {
  const configuredSources = sources.filter((source) => source.state !== "unconfigured" && source.severity !== "none");
  const severities = configuredSources.map((source) => source.severity);
  if (severities.includes("error")) return "unavailable";
  if (severities.includes("warning") && configuredSources.some((source) => source.state === "needs_sync")) return "needs_sync";
  if (severities.includes("warning")) return "degraded";
  return "current";
}

export function composeSystemStatus(providerHealth, { generatedAt = new Date().toISOString() } = {}) {
  const todoistState = providerHealth.todoist?.state || "unavailable";
  const billsState = providerHealth.bills?.state || "unavailable";
  const sources = [
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
      state: todoistState === "stale" ? "needs_sync" : todoistState,
      severity: providerHealth.todoist?.severity || (
        todoistState === "unavailable" ? "error" : todoistState === "syncing" ? "info" : "none"
      ),
      lastSuccessAt: providerHealth.todoist?.lastSuccessAt || null,
      message: todoistMessage(providerHealth.todoist),
    },
    {
      key: "bills",
      label: "Bills",
      state: billsState === "stale" ? "needs_sync" : billsState,
      severity: providerHealth.bills?.severity || (
        billsState === "unavailable" ? "error"
          : billsState === "needs_sync" || billsState === "degraded" || billsState === "stale" ? "warning"
            : billsState === "refreshing" || billsState === "syncing" ? "info"
              : "none"
      ),
      lastSuccessAt: providerHealth.bills?.lastSuccessAt || null,
      message: billsMessage(providerHealth.bills),
    },
  ];

  return {
    state: summarizeSystemState(sources),
    sources,
    generatedAt,
  };
}
