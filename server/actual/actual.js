import { runActualWorkerOperation } from "./actual-worker.js";
import { testActualConnectionHttp } from "./actual-connection-test.js";
import { readLocalActualMetadata } from "./actual-local-metadata.js";
import { sendBillLightweight } from "./actual-lightweight-writes.js";
import { buildBillOccurrencesFromSchedules } from "./actual-bill-occurrences.js";

export { isSchedulePaid } from "./actual-bill-occurrences.js";

const METADATA_TTL_MS = 5 * 60 * 1000;
const FORCE_METADATA_WORKER_TIMEOUT_MS = 30_000;
const WRITE_OPERATION_TIMEOUT_MS = 45_000;
const WRITE_OPERATION_WORKER_OPTIONS = {
  timeoutMs: WRITE_OPERATION_TIMEOUT_MS,
  shutdownAfterOperation: true,
};
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

function allowSdkWriteFallback() {
  return process.env.NODE_ENV !== "production" || process.env.EA_ACTUAL_SDK_WRITE_FALLBACK === "1";
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

// Clears every in-process Actual metadata cache: this facade's TTL cache and,
// when Actual runs in-process (tests/dev), actual-core's worker-side cache.
// Worker-mode write operations restart the worker (shutdownAfterOperation),
// so the worker-side cache does not outlive mutations there.
export async function invalidateActualMetadataCache() {
  clearMetadataCache();
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.js");
    core.clearMetadataCache();
  }
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
  const result = await callActual("markBillPaid", [scheduleId, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

// Bill writes are a 3-way branch; every path logs which one ran and why so a
// misbehaving write can be traced: (1) lightweight CRDT sync (production
// default), (2) SDK worker fallback when the lightweight path reports
// ACTUAL_LIGHTWEIGHT_UNSUPPORTED and the fallback is allowed, (3) in-process
// SDK in test/dev. Errors after the lightweight local write was applied
// (err.localWriteApplied) never fall back — retrying would duplicate the write.
export async function sendBill(billData, userId) {
  if (!shouldUseInProcessActual()) {
    try {
      const result = await sendBillLightweight(userId, billData);
      console.log("[EA] Bill write path: lightweight CRDT sync");
      clearMetadataCache();
      return result;
    } catch (err) {
      if (err?.code !== "ACTUAL_LIGHTWEIGHT_UNSUPPORTED" || !allowSdkWriteFallback()) {
        const reason = err?.code === "ACTUAL_LIGHTWEIGHT_UNSUPPORTED"
          ? "SDK fallback disabled"
          : err?.localWriteApplied
            ? "local write already applied; retry would duplicate"
            : `not an unsupported-feature error (code: ${err?.code || "none"})`;
        console.error(`[EA] Bill write failed on the lightweight path; no SDK fallback (${reason}):`, err.message);
        throw err;
      }
      console.warn("[EA] Bill write path: SDK worker fallback (lightweight unsupported):", err.message);
    }
  } else {
    console.log("[EA] Bill write path: SDK in-process (test/dev mode)");
  }
  const result = await callActual("sendBill", [billData, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export async function createQuickTxn(userId, payload) {
  const result = await callActual("createQuickTxn", [userId, payload], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export const __testing__ = {
  mapOpenBillInstances,
};
