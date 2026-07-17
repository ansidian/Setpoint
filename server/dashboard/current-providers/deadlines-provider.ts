import { readCurrentDeadlines } from "../../tasks/deadlines-read.ts";
import type { TodoistMirrorHealth } from "../../../shared/types/tasks.ts";
import type { CurrentDashboardCacheRow } from "../../../shared/types/dashboard.ts";
import type { CurrentDashboardProvider } from "../current-types.ts";

export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
};

function hasTodoistNeedsSync(todoistHealth: TodoistMirrorHealth | null | undefined): boolean {
  return todoistHealth?.state === "needs_sync" || todoistHealth?.state === "stale";
}

function isTodoistMirrorNewerThanDeadlines(
  todoistHealth: TodoistMirrorHealth | null | undefined,
  row: CurrentDashboardCacheRow | undefined,
): boolean {
  if (!todoistHealth?.lastSuccessAt || !row?.fetched_at) return false;
  return new Date(todoistHealth.lastSuccessAt).getTime() > new Date(String(row.fetched_at)).getTime();
}

const deadlinesProvider: CurrentDashboardProvider = {
  key: "deadlines_current",
  cacheTtlMs: 15 * 60 * 1000,
  fallbackPayload: () => ({ upcoming: [], stats: null }),
  hasUsablePayload: (payload) => Boolean(
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).upcoming),
  ),
  async fetchFresh(userId, _config, options = {}) {
    return readCurrentDeadlines(userId, { force: !!options.force });
  },
  // The deadlines cache mirrors the Todoist mirror: refresh even when the row
  // is fresh if Todoist needs a sync or has synced more recently than the row.
  refreshReasonOverride({ row, context }) {
    const todoistHealth = context?.todoistHealth || null;
    if (hasTodoistNeedsSync(todoistHealth) || isTodoistMirrorNewerThanDeadlines(todoistHealth, row)) {
      return "needs_sync";
    }
    return null;
  },
  manualRefreshReason() {
    return "manual_todoist_sync";
  },
};

export default deadlinesProvider;
