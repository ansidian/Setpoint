import {
  clearPendingBillsMirrorRefresh,
  consumeDueBillsMirrorRefresh,
  isBillsMirrorMaintenanceDue,
  readBillsMirrorCurrent,
  refreshBillsMirror,
  scheduleBillsMirrorRefresh,
} from "../../bills/bills-service.js";
import { publishCurrentDashboardEvent } from "../current-events.js";

// Bills refresh failures are dominated by the Actual provider being down;
// retrying on the generic passive cadence just burns the provider, so passive
// refreshes back off for much longer than the other sources.
const BILLS_PASSIVE_PROVIDER_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

function billsHealthProjection(health = null) {
  return {
    state: health?.state || null,
    configured: health?.configured ?? null,
    lastError: health?.lastError || null,
    pendingRefreshAt: health?.pendingRefreshAt || null,
    refreshStartedAt: health?.refreshStartedAt || null,
  };
}

function billsVisibleProjection(payload = null) {
  return {
    bills: payload?.bills || [],
    allSchedules: payload?.allSchedules || [],
    payeeMap: payload?.payeeMap || {},
    actualConfigured: !!payload?.actualConfigured,
    actualBudgetUrl: payload?.actualBudgetUrl || null,
    billsSyncHealth: billsHealthProjection(payload?.billsSyncHealth || payload?.syncHealth || null),
  };
}

function newestFailureTime(values) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : null;
}

function isInBillsProviderFailureBackoff(row, billsMirror, now) {
  const failureTime = newestFailureTime([
    row?.last_refresh_failed_at,
    billsMirror?.syncHealth?.lastAttemptAt,
  ]);
  if (!failureTime) return false;
  const rowFailed = Number(row?.refresh_failure_count || 0) > 0;
  const mirrorFailed = billsMirror?.syncHealth?.state === "degraded" || billsMirror?.syncHealth?.state === "unavailable";
  if (!rowFailed && !mirrorFailed) return false;
  return now.getTime() - failureTime < BILLS_PASSIVE_PROVIDER_FAILURE_BACKOFF_MS;
}

function shouldPublishChange(previousRow, previousPayload, nextPayload) {
  if (!previousPayload) return true;
  if (previousRow?.status && previousRow.status !== "current") return true;
  if (Number(previousRow?.refresh_failure_count || 0) > 0) return true;
  return JSON.stringify(billsVisibleProjection(previousPayload)) !== JSON.stringify(billsVisibleProjection(nextPayload));
}

const billsProvider = {
  key: "bills_current",
  cacheTtlMs: 60 * 60 * 1000,
  fallbackPayload: () => ({
    bills: [],
    allSchedules: [],
    payeeMap: {},
    actualConfigured: false,
    actualBudgetUrl: null,
  }),
  hasUsablePayload: (payload) => Boolean(
    Array.isArray(payload?.bills)
      && Array.isArray(payload?.allSchedules)
      && payload?.payeeMap,
  ),
  visibleProjection: billsVisibleProjection,
  shouldPublishChange,
  async fetchFresh(userId, config, options = {}) {
    const actualBudgetUrl = config.settings?.actual_budget_url || null;
    if (!actualBudgetUrl) {
      return refreshBillsMirror(userId, { ...options, actualBudgetUrl: null });
    }

    const dueRefresh = options.force
      ? false
      : await consumeDueBillsMirrorRefresh(userId, options).catch((err) => {
          console.error("[Dashboard] Bills mirror due-refresh check failed:", err.message);
          return false;
        });
    if (options.force || dueRefresh) {
      await clearPendingBillsMirrorRefresh(userId, options);
      return refreshBillsMirror(userId, {
        ...options,
        actualBudgetUrl,
        refreshLocalActual: true,
      });
    }

    const payload = await readBillsMirrorCurrent(userId, options);
    if (payload.billsSyncHealth?.state === "needs_sync") {
      scheduleBillsMirrorRefresh(userId, options).catch((err) => {
        console.error("[Dashboard] Bills mirror refresh scheduling failed:", err.message);
      });
    }
    return payload;
  },
  onRefreshed(userId, { previousRow, previousPayload }, nextPayload, { now = new Date(), refreshReason = null } = {}) {
    if (!shouldPublishChange(previousRow, previousPayload, nextPayload)) return;
    publishCurrentDashboardEvent(userId, {
      source: "bills",
      reason: refreshReason === "bills_mirror_maintenance_due" ? "maintenance_refreshed" : "changed",
      state: "current",
      occurredAt: now.toISOString(),
    });
  },
  manualRefreshReason({ context }) {
    return context?.billsMirror?.syncHealth?.pendingRefreshAt
      ? "pending_bills_mirror"
      : "manual_bills_sync";
  },
  passiveSuppressReason({ row, now, context }) {
    return isInBillsProviderFailureBackoff(row, context?.billsMirror || null, now)
      ? "provider_backoff"
      : null;
  },
  maintenanceRefreshReason({ now, context }) {
    return isBillsMirrorMaintenanceDue(context?.billsMirror?.syncHealth, { now })
      ? "bills_mirror_maintenance_due"
      : null;
  },
};

export default billsProvider;
