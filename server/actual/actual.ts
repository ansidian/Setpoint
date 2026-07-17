import { runActualWorkerOperation } from "./actual-worker.ts";
import { testActualConnectionHttp } from "./actual-connection-test.ts";
import { readLocalActualMetadata } from "./actual-local-metadata.ts";
import { sendBillLightweight } from "./actual-lightweight-writes.ts";
import { buildBillOccurrencesFromSchedules } from "./actual-bill-occurrences.ts";
import type { ActualWorkerOperation, ActualWorkerOptions } from "./actual-worker-protocol.ts";
import type {
  ActualAccount,
  ActualBillOccurrence,
  ActualCategoryGroup,
  ActualDateRange,
  ActualMetadata,
  ActualPayee,
  ActualRecentTransaction,
  ActualSchedule,
} from "../../shared/types/actual.ts";

export interface ActualBillWriteInput {
  amount: number;
  due_date: string;
  type?: string;
  [key: string]: unknown;
}

export interface ActualQuickTransactionInput {
  accountName?: string;
  amount?: number;
  payee?: string;
  type?: string;
  date?: string;
  notes?: string;
  categoryName?: string | null;
}

export interface ActualQuickTransactionResult {
  success: true;
  account: string;
  payee: string;
  amount: number;
  type: string;
  date: string;
  category: string | null;
}

export interface ActualCalendarBillsRangeResult {
  schedules: ActualBillOccurrence[];
  recentTransactions: ActualRecentTransaction[];
  payeeMap: Record<string, string>;
  actualBudgetUrl: string;
}

export { isSchedulePaid } from "./actual-bill-occurrences.ts";

const METADATA_TTL_MS = 5 * 60 * 1000;
const FORCE_METADATA_WORKER_TIMEOUT_MS = 30_000;
const WRITE_OPERATION_TIMEOUT_MS = 45_000;
const WRITE_OPERATION_WORKER_OPTIONS = {
  timeoutMs: WRITE_OPERATION_TIMEOUT_MS,
  shutdownAfterOperation: true,
};
let metadataCache: { data: ActualMetadata | null; ts: number } = { data: null, ts: 0 };

function mapOpenBillInstances(schedules: ActualSchedule[], payeeMap: Record<string, string>, range: ActualDateRange): ActualBillOccurrence[] {
  return buildBillOccurrencesFromSchedules(schedules, {
    payeeMap,
    recentTransactions: range.recentTransactions || [],
    range,
  });
}

function shouldUseInProcessActual(): boolean {
  return process.env.NODE_ENV === "test" || process.env.EA_ACTUAL_WORKER_DISABLED === "1";
}

function allowSdkWriteFallback(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.EA_ACTUAL_SDK_WRITE_FALLBACK === "1";
}

async function callActual<T>(operation: ActualWorkerOperation, args: unknown[], options: ActualWorkerOptions = {}): Promise<T> {
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.ts");
    const handler: unknown = Reflect.get(core, operation);
    if (typeof handler !== "function") throw Object.assign(new Error(`Unknown Actual operation: ${operation}`), { status: 400 });
    return await Reflect.apply(handler, core, args) as T;
  }
  return runActualWorkerOperation(operation, args, options);
}

function clearMetadataCache(): void {
  metadataCache = { data: null, ts: 0 };
}

// Clears every in-process Actual metadata cache: this facade's TTL cache and,
// when Actual runs in-process (tests/dev), actual-core's worker-side cache.
// Worker-mode write operations restart the worker (shutdownAfterOperation),
// so the worker-side cache does not outlive mutations there.
export async function invalidateActualMetadataCache(): Promise<void> {
  clearMetadataCache();
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.ts");
    core.clearMetadataCache();
  }
}

export function testConnection(userId: string, overrides: Parameters<typeof testActualConnectionHttp>[1] = null) {
  return testActualConnectionHttp(userId, overrides);
}

export async function getMetadata(userId: string, { forceWorker = false, forceRefresh = false }: { forceWorker?: boolean; forceRefresh?: boolean } = {}): Promise<ActualMetadata> {
  if (shouldUseInProcessActual()) return callActual<ActualMetadata>("getMetadata", [userId, { forceRefresh }]);
  if (forceWorker) {
    const data = await callActual<ActualMetadata>(
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
  } catch (err: unknown) {
    console.warn("[EA] Lightweight Actual metadata read failed; falling back to Actual worker:", err instanceof Error ? err.message : err);
  }
  const data = await callActual<ActualMetadata>(
    "getMetadata",
    [userId, { forceRefresh }],
    forceRefresh ? { timeoutMs: FORCE_METADATA_WORKER_TIMEOUT_MS } : {},
  );
  metadataCache = { data, ts: Date.now() };
  return data;
}

export async function getAccounts(userId: string): Promise<ActualAccount[]> {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function getRecentTransactions(userId: string): Promise<ActualRecentTransaction[]> {
  const { recentTransactions } = await getMetadata(userId);
  return recentTransactions;
}

export async function getPayees(userId: string): Promise<ActualPayee[]> {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function getCategories(userId: string): Promise<ActualCategoryGroup[]> {
  const { categories } = await getMetadata(userId);
  return categories;
}

export function getUpcomingBills(userId: string): Promise<unknown> {
  return callActual<unknown>("getUpcomingBills", [userId]);
}

export function getCalendarBillsRange(userId: string, range: ActualDateRange): Promise<ActualCalendarBillsRangeResult> {
  return callActual<ActualCalendarBillsRangeResult>("getCalendarBillsRange", [userId, range]);
}

export async function markBillPaid(scheduleId: string, userId: string): Promise<unknown> {
  const result = await callActual<unknown>("markBillPaid", [scheduleId, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

// Bill writes are a 3-way branch; every path logs which one ran and why so a
// misbehaving write can be traced: (1) lightweight CRDT sync (production
// default), (2) SDK worker fallback when the lightweight path reports
// ACTUAL_LIGHTWEIGHT_UNSUPPORTED and the fallback is allowed, (3) in-process
// SDK in test/dev. Errors after the lightweight local write was applied
// (err.localWriteApplied) never fall back — retrying would duplicate the write.
export async function sendBill(billData: ActualBillWriteInput, userId: string): Promise<unknown> {
  if (!shouldUseInProcessActual()) {
    try {
      const result = await sendBillLightweight(userId, billData);
      console.log("[EA] Bill write path: lightweight CRDT sync");
      clearMetadataCache();
      return result;
    } catch (err: unknown) {
      const error = typeof err === "object" && err !== null ? err as Record<string, unknown> : {};
      if (error.code !== "ACTUAL_LIGHTWEIGHT_UNSUPPORTED" || !allowSdkWriteFallback()) {
        const reason = error.code === "ACTUAL_LIGHTWEIGHT_UNSUPPORTED"
          ? "SDK fallback disabled"
          : error.localWriteApplied
            ? "local write already applied; retry would duplicate"
            : `not an unsupported-feature error (code: ${String(error.code || "none")})`;
        console.error(`[EA] Bill write failed on the lightweight path; no SDK fallback (${reason}):`, err instanceof Error ? err.message : err);
        throw err;
      }
      console.warn("[EA] Bill write path: SDK worker fallback (lightweight unsupported):", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("[EA] Bill write path: SDK in-process (test/dev mode)");
  }
  const result = await callActual<unknown>("sendBill", [billData, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export async function createQuickTxn(userId: string, payload: ActualQuickTransactionInput): Promise<ActualQuickTransactionResult> {
  const result = await callActual<ActualQuickTransactionResult>("createQuickTxn", [userId, payload], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export const __testing__ = {
  mapOpenBillInstances,
};
