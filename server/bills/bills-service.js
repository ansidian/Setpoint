import {
  sendBill as actualSendBill,
  markBillPaid as actualMarkBillPaid,
  testConnection as actualTestConnection,
  createQuickTxn as actualCreateQuickTxn,
  invalidateActualMetadataCache,
} from "../actual/actual.ts";
import db from "../db/connection.ts";
import { resolveBillPaySample as resolveBillPaySampleCore } from "./bill-pay-service.js";
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
} from "./bills-mirror-sync.js";
export { resolveBillPaySeed } from "./bill-pay-service.js";
export {
  getMetadata,
  readActualMetadataProjection,
  refreshActualMetadataProjection,
} from "../actual/actual-metadata-projection.ts";
export { extractBill } from "./bill-extraction-service.js";
export { shouldScheduleImmediateBillsRefresh } from "./bills-mirror-refresh-policy.js";
export {
  BILLS_MIRROR_MAINTENANCE_TTL_MS,
  __resetBillsMirrorRefreshTimersForTests,
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
} from "./bills-mirror-sync.js";

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
export async function invalidateActualMetadata(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  await invalidateActualMetadataCache();
  const metadata = await loadActualMetadataForProjection(userId, { preferFreshLocal: true })
    .catch((err) => {
      console.warn("[EA] Fresh Actual metadata load failed during invalidation; using cached sources:", err.message);
      return null;
    });
  return refreshActualMetadataProjection(userId, { dbClient, now, metadata });
}

function invalidateActualMetadataInBackground(userId) {
  invalidateActualMetadata(userId).catch((err) => {
    console.error("[EA] Actual metadata invalidation failed:", err.message);
  });
}

async function scheduleBillsMirrorRefreshInBackground(userId, delayMs) {
  return scheduleBillsMirrorRefresh(userId, { delayMs }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
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
async function withLocalWriteReconciliation(userId, run, { delayMs }) {
  try {
    return await run();
  } catch (err) {
    if (err?.localWriteApplied !== true) throw err;
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

export async function sendBill(userId, billData) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualSendBill(billData, userId);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function markBillPaid(userId, billId) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualMarkBillPaid(billId, userId);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function listAccounts(userId) {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function listCategories(userId) {
  const { categories } = await getMetadata(userId);
  return categories;
}

export async function listPayees(userId) {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function testConnection(userId, overrides) {
  return actualTestConnection(userId, overrides);
}

export async function createQuickTxn(userId, payload) {
  return withLocalWriteReconciliation(userId, async () => {
    const result = await actualCreateQuickTxn(userId, payload);
    invalidateActualMetadataInBackground(userId);
    await scheduleBillsMirrorRefreshInBackground(userId, 60_000);
    return result;
  }, { delayMs: 60_000 });
}

export async function hydrateActualCache(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
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

export async function getActualCacheStatus(userId, {
  dbClient = db,
} = {}) {
  return describeLocalActualCache(userId, { dbClient });
}

export async function resolveBillPaySample(userId, payload = {}) {
  const metadata = await getMetadata(userId);
  return resolveBillPaySampleCore(userId, { ...payload, metadata });
}
