export const ACTIVE_SNAPSHOT_REFRESH_SCOPE = "active_snapshot";
export const CURRENT_REFRESH_SCOPE = "current";

export function refreshScopeForDashboardEvent(event) {
  return event?.source === "email_triage"
    ? ACTIVE_SNAPSHOT_REFRESH_SCOPE
    : CURRENT_REFRESH_SCOPE;
}

export function mergeRefreshScopes(left, right) {
  if (left === CURRENT_REFRESH_SCOPE || right === CURRENT_REFRESH_SCOPE) {
    return CURRENT_REFRESH_SCOPE;
  }
  if (left === ACTIVE_SNAPSHOT_REFRESH_SCOPE || right === ACTIVE_SNAPSHOT_REFRESH_SCOPE) {
    return ACTIVE_SNAPSHOT_REFRESH_SCOPE;
  }
  return null;
}
