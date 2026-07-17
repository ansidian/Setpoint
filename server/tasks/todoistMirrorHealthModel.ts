const HEALTH_DEGRADED_AFTER_MS = 24 * 60 * 60 * 1000;

import type { TodoistMirrorHealth, TodoistMirrorHealthSeverity, TodoistMirrorHealthState } from "../../shared/types/tasks.ts";

export interface TodoistSyncStateRow {
  status?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  sync_started_at?: string | null;
  sync_requested_at?: string | null;
  sync_request_reason?: string | null;
  last_check_failed_at?: string | null;
  failed_check_count?: number | string | null;
}

function isAfter(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function hasPendingSyncEvidence(state: TodoistSyncStateRow): boolean {
  return isAfter(state.sync_requested_at, state.last_success_at);
}

function failureAgeMs(state: TodoistSyncStateRow, now: Date): number | null {
  const since = state.last_success_at || state.last_check_failed_at;
  if (!since) return null;
  return Math.max(0, now.getTime() - new Date(since).getTime());
}

// Pure derivation of the Todoist mirror health shape from the already-loaded
// sync-state row. `configured` is the truthiness of the user's Todoist token
// (the caller does the IO read); state is the ea_todoist_sync_state row or null.
export function computeTodoistMirrorHealth(
  state: TodoistSyncStateRow | null | undefined,
  { now = new Date(), configured = false }: { now?: Date; configured?: boolean } = {},
): TodoistMirrorHealth {
  if (!configured) {
    return {
      state: "unconfigured",
      configured: false,
      severity: "none",
      lastSuccessAt: null,
      lastError: null,
      syncStartedAt: null,
      syncRequestedAt: null,
      syncRequestReason: null,
      lastCheckFailedAt: null,
      failedCheckCount: 0,
      ageMs: null,
    };
  }

  if (!state) {
    return {
      state: "unavailable",
      configured: true,
      severity: "error",
      lastSuccessAt: null,
      lastError: null,
      syncStartedAt: null,
      syncRequestedAt: null,
      syncRequestReason: null,
      lastCheckFailedAt: null,
      failedCheckCount: 0,
      ageMs: null,
    };
  }

  const lastSuccessAt = state.last_success_at || null;
  const ageMs = lastSuccessAt
    ? Math.max(0, now.getTime() - new Date(lastSuccessAt).getTime())
    : null;
  const pendingEvidence = hasPendingSyncEvidence(state);
  const failedCheckCount = Number(state.failed_check_count || 0);
  const failedAge = failureAgeMs(state, now);
  const degradedByFailedChecks = !pendingEvidence
    && failedCheckCount > 0
    && failedAge != null
    && failedAge >= HEALTH_DEGRADED_AFTER_MS;

  let nextState: TodoistMirrorHealthState;
  let severity: TodoistMirrorHealthSeverity;
  if (state.status === "syncing") {
    nextState = "syncing";
    severity = pendingEvidence ? "warning" : "info";
  } else if (!lastSuccessAt) {
    nextState = "unavailable";
    severity = "error";
  } else if (pendingEvidence) {
    nextState = "needs_sync";
    severity = "warning";
  } else if (degradedByFailedChecks) {
    nextState = "degraded";
    severity = "warning";
  } else {
    nextState = "current";
    severity = "none";
  }

  return {
    state: nextState,
    configured: true,
    severity,
    lastSuccessAt,
    lastError: state.last_error || null,
    syncStartedAt: state.sync_started_at || null,
    syncRequestedAt: state.sync_requested_at || null,
    syncRequestReason: state.sync_request_reason || null,
    lastCheckFailedAt: state.last_check_failed_at || null,
    failedCheckCount,
    ageMs,
  };
}
