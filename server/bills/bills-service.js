import {
  sendBill as actualSendBill,
  markBillPaid as actualMarkBillPaid,
  testConnection as actualTestConnection,
  createQuickTxn as actualCreateQuickTxn,
  invalidateActualMetadataCache,
} from "../actual/actual.js";
import db from "../db/connection.js";
import { resolveBillPaySample as resolveBillPaySampleCore } from "./bill-pay-service.js";
import {
  describeLocalActualCache,
  hydrateLocalActualCache,
} from "../actual/actual-local-metadata.js";
import {
  getMetadata,
  loadActualMetadataForProjection,
  refreshActualMetadataProjection,
} from "../actual/actual-metadata-projection.js";
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
} from "../actual/actual-metadata-projection.js";
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
} from "./bills-mirror-sync.js";

// Actual metadata (accounts, payees, categories, schedules) is cached at four
// levels:
//
//   (a) src/lib/actualMetadata.js singleton — frontend; cleared by the bills
//       SSE event (invalidateActualMetadata in that module), refetched on next use
//   (b) in-process TTL caches — actual.js facade + actual-core.js (5 min);
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

export async function sendBill(userId, billData) {
  const result = await actualSendBill(billData, userId);
  invalidateActualMetadataInBackground(userId);
  await scheduleBillsMirrorRefresh(userId, { delayMs: 60_000 }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
  });
  return result;
}

export async function markBillPaid(userId, billId) {
  const result = await actualMarkBillPaid(billId, userId);
  invalidateActualMetadataInBackground(userId);
  await scheduleBillsMirrorRefresh(userId, { delayMs: 60_000 }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
  });
  return result;
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
  const result = await actualCreateQuickTxn(userId, payload);
  invalidateActualMetadataInBackground(userId);
  await scheduleBillsMirrorRefresh(userId, { delayMs: 60_000 }).catch((err) => {
    console.error("[EA] Bills mirror delayed refresh scheduling failed:", err.message);
  });
  return result;
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
