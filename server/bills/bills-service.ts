import {
  testConnection as actualTestConnection,
  hydrateActualCache as hydrateActualWorkerCache,
  removeActualConnection as removeStoredActualConnection,
  saveActualConnectionCandidate,
  type ActualConnectionCandidate,
} from "../actual/actual.ts";
import db from "../db/connection.ts";
import {
  describeLocalActualCache,
} from "../actual/actual-local-metadata.ts";
import { loadActualBudgetUrl, refreshBillsMirror } from "./bills-mirror-sync.ts";
import type { BillsMirrorDb } from "./bills-mirror-sync.ts";
import type { LocalActualOptions } from "../actual/actual-local-metadata.ts";
import { capabilityStatusService } from "../capability-status-service.ts";

export {
  BILLS_MIRROR_MAINTENANCE_TTL_MS,
  armPendingBillsMirrorRefreshes,
  billMirrorRefreshRange,
  clearPendingBillsMirrorRefresh,
  consumeDueBillsMirrorRefresh,
  getBillsMirrorState,
  isBillsMirrorMaintenanceDue,
  readBillsMirrorCurrent,
  readBillsMirrorRange,
  refreshBillsMirror,
  runDueBillsMirrorRefresh,
  scheduleBillsMirrorRefresh,
  startBillsMirrorRefreshWorker,
  stopBillsMirrorRefreshWorker,
} from "./bills-mirror-sync.ts";

export async function testConnection(userId: string, overrides: Parameters<typeof actualTestConnection>[1] = null) {
  return actualTestConnection(userId, overrides);
}

export async function saveActualConnection(userId: string, candidate: ActualConnectionCandidate) {
  const result = await saveActualConnectionCandidate(userId, candidate);
  capabilityStatusService.invalidate();
  return result;
}

export async function removeActualConnection(userId: string) {
  const result = await removeStoredActualConnection(userId);
  capabilityStatusService.invalidate();
  return result;
}

export async function hydrateActualCache(userId: string, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: BillsMirrorDb & NonNullable<LocalActualOptions["dbClient"]>; now?: Date } = {}) {
  const hydrated = await hydrateActualWorkerCache(userId);
  const actualBudgetUrl = await loadActualBudgetUrl(userId, { dbClient });
  const mirror = await refreshBillsMirror(userId, { actualBudgetUrl, dbClient, now });
  return {
    ...hydrated,
    billsCount: mirror.bills?.length || 0,
    schedulesCount: mirror.allSchedules?.length || 0,
    syncHealth: mirror.billsSyncHealth || mirror.syncHealth || null,
  };
}

export async function getActualCacheStatus(userId: string, {
  dbClient = db,
}: { dbClient?: NonNullable<LocalActualOptions["dbClient"]> } = {}) {
  return describeLocalActualCache(userId, { dbClient });
}
