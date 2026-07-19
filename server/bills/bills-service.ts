import {
  sendBill as actualSendBill,
  markBillPaid as actualMarkBillPaid,
  testConnection as actualTestConnection,
  createQuickTxn as actualCreateQuickTxn,
  invalidateActualMetadataCache,
  removeActualConnection as removeStoredActualConnection,
  saveActualConnectionCandidate,
  type ActualConnectionCandidate,
} from "../actual/actual.ts";
import db from "../db/connection.ts";
import { resolveBillPaySample as resolveBillPaySampleCore } from "./bill-pay-service.ts";
import {
  describeLocalActualCache,
  hydrateLocalActualCache,
} from "../actual/actual-local-metadata.ts";
import {
  getMetadata,
  loadActualMetadataForProjection,
  refreshActualMetadataProjection,
} from "../actual/actual-metadata-projection.ts";
import {
  loadActualBudgetUrl,
  refreshBillsMirror,
  scheduleBillsMirrorRefresh,
} from "./bills-mirror-sync.ts";
import type { BillsMirrorDb } from "./bills-mirror-sync.ts";
import type { SampleOptions } from "./bill-pay-service.ts";
import type { LocalActualOptions } from "../actual/actual-local-metadata.ts";
import type { ActualBillWriteInput, ActualQuickTransactionInput } from "../actual/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import { capabilityStatusService } from "../capability-status-service.ts";

type ReconciliationError = Error & {
  localWriteApplied?: boolean;
  code?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export { resolveBillPaySeed } from "./bill-pay-service.ts";
export {
  getMetadata,
  readActualMetadataProjection,
  refreshActualMetadataProjection,
} from "../actual/actual-metadata-projection.ts";
export { extractBill } from "./bill-extraction-service.ts";
export { shouldScheduleImmediateBillsRefresh } from "./bills-mirror-refresh-policy.ts";
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

// Actual metadata (accounts, payees, categories, schedules) is cached at four
// levels:
//
//   (a) src/lib/actualMetadata.ts singleton — frontend; cleared by the bills
//       SSE event (invalidateActualMetadata in that module), refetched on next use
//   (b) in-process TTL caches — actual.ts facade + actual-core.ts (5 min);
//       cleared by invalidateActualMetadataCache()
//   (c) ea_actual_metadata_mirror — DB projection served by GET /actual/metadata;
//       rewritten by refreshActualMetadataProjection()
//   (d) lightweight local budget copy on disk — re-synced from the Actual
//       server when the projection loads with preferFreshLocal
//
//   Actual server ──sync──▶ (d) ──project──▶ (c) ──/actual/metadata──▶ (a)
//                  (b) caches SDK/local reads used by writes and fallbacks
//
// This is the single authoritative invalidation: it clears (b), re-syncs (d),
// and rewrites (c). Layer (a) clears itself when the bills SSE event arrives.
export async function invalidateActualMetadata(userId: string, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: BillsMirrorDb; now?: Date } = {}) {
  await invalidateActualMetadataCache();
  const metadata = await loadActualMetadataForProjection(userId, { preferFreshLocal: true })
    .catch((err: unknown) => {
      console.warn("[EA] Fresh Actual metadata load failed during invalidation; using cached sources:", errorMessage(err));
      return null;
    });
  return refreshActualMetadataProjection(userId, { dbClient, now, metadata });
}

function invalidateActualMetadataInBackground(userId: string): void {
  invalidateActualMetadata(userId).catch((err: unknown) => {
    console.error("[EA] Actual metadata invalidation failed:", errorMessage(err));
  });
}

async function scheduleBillsMirrorRefreshInBackground(userId: string, delayMs: number) {
  return scheduleBillsMirrorRefresh(userId, { delayMs }).catch((err: unknown) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", errorMessage(err));
    return null;
  });
}

// A lightweight write that was applied to the local budget copy but failed
// while pushing to the Actual server throws with err.localWriteApplied === true
// (set in actual-lightweight-writes.ts; never retried — see actual.ts). The
// write IS durable locally and re-syncs on the next successful push, so the
// downstream invalidation fan-out must still run: without it the metadata
// mirror and bills mirror keep serving pre-write data with no scheduled
// reconciliation. We also convert the hard failure into a partial-success
// return so the route answers 200 and the UI does not prompt a duplicate-
// inducing retry. Any other error (no local write applied) re-throws unchanged.
async function withLocalWriteReconciliation<T>(userId: string, run: () => Promise<T>, { delayMs }: { delayMs: number }): Promise<T | { syncPending: true; localWriteApplied: true; message: string; code: string }> {
  try {
    return await run();
  } catch (error: unknown) {
    const err = error as ReconciliationError;
    if (err.localWriteApplied !== true) throw error;
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, delayMs);
    return {
      syncPending: true,
      localWriteApplied: true,
      message: err.message,
      code: err.code || "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
    };
  }
}

export async function sendBill(userId: string, billData: BillCandidate) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualSendBill(billData as ActualBillWriteInput, userId);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function markBillPaid(userId: string, billId: string) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualMarkBillPaid(billId, userId);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function listAccounts(userId: string) {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function listCategories(userId: string) {
  const { categories } = await getMetadata(userId);
  return categories;
}

export async function listPayees(userId: string) {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function testConnection(userId: string, overrides: Parameters<typeof actualTestConnection>[1] = null) {
  return actualTestConnection(userId, overrides);
}

export async function saveActualConnection(userId: string, candidate: ActualConnectionCandidate) {
  const result = await saveActualConnectionCandidate(userId, candidate);
  await invalidateActualMetadataCache();
  capabilityStatusService.invalidate();
  return result;
}

export async function removeActualConnection(userId: string) {
  const result = await removeStoredActualConnection(userId);
  await invalidateActualMetadataCache();
  capabilityStatusService.invalidate();
  return result;
}

export async function createQuickTxn(userId: string, payload: ActualQuickTransactionInput) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualCreateQuickTxn(userId, payload);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function hydrateActualCache(userId: string, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: BillsMirrorDb & NonNullable<LocalActualOptions["dbClient"]>; now?: Date } = {}) {
  const hydrated = await hydrateLocalActualCache(userId, { dbClient });
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

export async function resolveBillPaySample(userId: string, payload: SampleOptions = {}) {
  const metadata = await getMetadata(userId);
  return resolveBillPaySampleCore(userId, { ...payload, metadata });
}
