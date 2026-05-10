import { runActualWorkerOperation } from "./actual-worker.js";
import { testActualConnectionHttp } from "./actual-connection-test.js";
import { readLocalActualMetadata } from "./actual-local-metadata.js";
import { buildBillOccurrencesFromSchedules } from "./actual-bill-occurrences.js";

export { isSchedulePaid } from "./actual-bill-occurrences.js";

const METADATA_TTL_MS = 5 * 60 * 1000;
const FORCE_METADATA_WORKER_TIMEOUT_MS = 30_000;
let metadataCache = { data: null, ts: 0 };

function mapOpenBillInstances(schedules, payeeMap, range) {
  return buildBillOccurrencesFromSchedules(schedules, {
    payeeMap,
    recentTransactions: range.recentTransactions || [],
    range,
  });
}

function shouldUseInProcessActual() {
  return process.env.NODE_ENV === "test" || process.env.EA_ACTUAL_WORKER_DISABLED === "1";
}

async function callActual(operation, args, options = {}) {
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.js");
    return core[operation](...args);
  }
  return runActualWorkerOperation(operation, args, options);
}

function clearMetadataCache() {
  metadataCache = { data: null, ts: 0 };
}

export function testConnection(userId, overrides = null) {
  return testActualConnectionHttp(userId, overrides);
}

export async function getMetadata(userId, { forceWorker = false, forceRefresh = false } = {}) {
  if (shouldUseInProcessActual()) return callActual("getMetadata", [userId, { forceRefresh }]);
  if (forceWorker) {
    const data = await callActual(
      "getMetadata",
      [userId, { forceRefresh }],
      forceRefresh ? { timeoutMs: FORCE_METADATA_WORKER_TIMEOUT_MS } : {},
    );
    metadataCache = { data, ts: Date.now() };
    return data;
  }
  const now = Date.now();
  if (!forceRefresh && metadataCache.data && now - metadataCache.ts < METADATA_TTL_MS) {
    return metadataCache.data;
  }
  try {
    const localData = await readLocalActualMetadata(userId, { refresh: forceRefresh });
    metadataCache = { data: localData, ts: Date.now() };
    return localData;
  } catch (err) {
    console.warn("[EA] Lightweight Actual metadata read failed; falling back to Actual worker:", err.message);
  }
  const data = await callActual(
    "getMetadata",
    [userId, { forceRefresh }],
    forceRefresh ? { timeoutMs: FORCE_METADATA_WORKER_TIMEOUT_MS } : {},
  );
  metadataCache = { data, ts: Date.now() };
  return data;
}

export async function getAccounts(userId) {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function getRecentTransactions(userId) {
  const { recentTransactions } = await getMetadata(userId);
  return recentTransactions;
}

export async function getPayees(userId) {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function getCategories(userId) {
  const { categories } = await getMetadata(userId);
  return categories;
}

export function getUpcomingBills(userId) {
  return callActual("getUpcomingBills", [userId]);
}

export function getCalendarBillsRange(userId, range) {
  return callActual("getCalendarBillsRange", [userId, range]);
}

export async function markBillPaid(scheduleId, userId) {
  const result = await callActual("markBillPaid", [scheduleId, userId]);
  clearMetadataCache();
  return result;
}

export async function sendBill(billData, userId) {
  const result = await callActual("sendBill", [billData, userId]);
  clearMetadataCache();
  return result;
}

export async function createQuickTxn(userId, payload) {
  const result = await callActual("createQuickTxn", [userId, payload]);
  clearMetadataCache();
  return result;
}

export const __testing__ = {
  mapOpenBillInstances,
};
