export { readActualMetadataProjection } from './actual-metadata-projection.ts';
import { coordinateActualWrite, guardOrdinaryActualWrite, guardCorrectedOriginalIdentity } from './actual-write-coordination.ts';
import type { CorrectionSnapshot, CorrectionStep, CorrectionTargets, CorrectionStepStatus } from '../../shared/types/financial-corrections.ts';
import type { FinancialBindingInspection } from "../../shared/types/financial-activity.ts";
import type { ActualTransferScheduleInput, ActualTransferScheduleMode, ActualTransferScheduleResult } from "../../shared/types/transaction-imports.ts";
import type { ActualFinancialOperationInput, ActualFinancialOperationMode, ActualFinancialOperationResult } from "../../shared/types/financial-operations.ts";
import { runActualWorkerOperation, stopActualWorker as stopWorker } from "./actual-worker.ts";
import { testActualConnectionHttp } from "./actual-connection-test.ts";
import type { CacheDescription } from "./actual-local-metadata.ts";
import { readLocalActualMetadata } from "./actual-local-metadata.ts";
import type { ActualWorkerOperation, ActualWorkerOptions } from "./actual-worker-protocol.ts";
import type {
  ActualMetadata,
} from "../../shared/types/actual.ts";
import type {
  ActualImportAccountGroup,
  ActualImportBatchResult,
} from "../../shared/types/transaction-imports.ts";

export type { ActualConnectionCandidate } from "./actual-connection-settings.ts";
import type { ActualConnectionCandidate } from "./actual-connection-settings.ts";

export async function saveActualConnectionCandidate(userId: string, candidate: ActualConnectionCandidate) {
  const service = await import("./actual-connection-settings.ts");
  const result = await service.saveActualConnectionCandidate(userId, candidate);
  clearMetadataCache();
  await callActual<void>("shutdownActual", []);
  return result;
}

export async function removeActualConnection(userId: string) {
  const service = await import("./actual-connection-settings.ts");
  const result = await service.removeActualConnection(userId);
  clearMetadataCache();
  await callActual<void>("shutdownActual", []);
  return result;
}

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

export { isSchedulePaid } from "./actual-bill-occurrences.ts";
// Read-only transaction consumers use the same domain facade without starting the SDK.
export { readJournalRange } from './actual-journal-read.ts';
export { readTransactionsRange } from "./actual-transactions-read.ts";

const METADATA_TTL_MS = 5 * 60 * 1000;
const FORCE_METADATA_WORKER_TIMEOUT_MS = 30_000;
const WRITE_OPERATION_TIMEOUT_MS = 45_000;
const WRITE_OPERATION_WORKER_OPTIONS = {
  timeoutMs: WRITE_OPERATION_TIMEOUT_MS,
};
let metadataCache: { data: ActualMetadata | null; ts: number } = { data: null, ts: 0 };

function shouldUseInProcessActual(): boolean {
  return process.env.NODE_ENV === "test" || process.env.EA_ACTUAL_WORKER_DISABLED === "1";
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

// The worker stays warm: invalidate both metadata caches explicitly.
export async function invalidateActualMetadataCache(): Promise<void> {
  clearMetadataCache();
  await callActual<void>("clearMetadataCache", []);
}

export async function stopActualWorker(): Promise<void> {
  if (shouldUseInProcessActual()) return callActual<void>("shutdownActual", []);
  await stopWorker();
}

export async function hydrateActualCache(userId: string) {
  clearMetadataCache();
  return callActual<CacheDescription>("hydrateCache", [userId]);
}

// Sync and project inside the worker's serialized session. Parent readers never
// mutate the on-disk budget behind the SDK's loaded state.
export async function syncActualMetadata(userId: string): Promise<ActualMetadata> {
  clearMetadataCache();
  return callActual<ActualMetadata>("syncMetadata", [userId]);
}

export function testConnection(userId: string, overrides: Parameters<typeof testActualConnectionHttp>[1] = null) {
  return testActualConnectionHttp(userId, overrides);
}

export async function getMetadata(userId: string, { forceWorker = false, forceRefresh = false }: { forceWorker?: boolean; forceRefresh?: boolean } = {}): Promise<ActualMetadata> {
  if (shouldUseInProcessActual()) return callActual<ActualMetadata>("getMetadata", [userId, { forceRefresh }]);
  if (forceWorker || forceRefresh) {
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
    const localData = await readLocalActualMetadata(userId, { localOnly: true });
    metadataCache = { data: localData, ts: Date.now() };
    return localData;
  } catch (err: unknown) {
    console.warn("[EA] Local Actual metadata read failed; falling back to Actual worker:", err instanceof Error ? err.message : err);
  }
  const data = await callActual<ActualMetadata>(
    "getMetadata",
    [userId, { forceRefresh }],
    forceRefresh ? { timeoutMs: FORCE_METADATA_WORKER_TIMEOUT_MS } : {},
  );
  metadataCache = { data, ts: Date.now() };
  return data;
}

async function markBillPaidInner(scheduleId: string, userId: string): Promise<unknown> {
  const result = await callActual<unknown>("markBillPaid", [scheduleId, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

async function sendBillInner(billData: ActualBillWriteInput, userId: string): Promise<unknown> {
  const result = await callActual<unknown>("sendBill", [billData, userId], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

async function createQuickTxnInner(userId: string, payload: ActualQuickTransactionInput): Promise<ActualQuickTransactionResult> {
  const result = await callActual<ActualQuickTransactionResult>("createQuickTxn", [userId, payload], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

async function importTransactionGroupsInner(
  userId: string,
  groups: ActualImportAccountGroup[],
  dryRun: boolean,
): Promise<ActualImportBatchResult> {
  const result = await callActual<ActualImportBatchResult>(
    "importTransactionGroups",
    [userId, groups, dryRun],
    WRITE_OPERATION_WORKER_OPTIONS,
  );
  if (!dryRun) clearMetadataCache();
  return result;
}

async function reconcileTransferScheduleInner(userId: string, input: ActualTransferScheduleInput, mode: ActualTransferScheduleMode): Promise<ActualTransferScheduleResult> {
  const result = await callActual<ActualTransferScheduleResult>("reconcileTransferSchedule", [userId, input, mode], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export async function inspectOriginalImportBinding(userId: string, budgetId: string, accountId: string, importedId: string, targetId?: string) {
  return callActual<FinancialBindingInspection>(
    "inspectOriginalImportBinding", [userId, budgetId, accountId, importedId, targetId], WRITE_OPERATION_WORKER_OPTIONS);
}

async function reconcileFinancialOperationInner(userId: string, input: ActualFinancialOperationInput, mode: ActualFinancialOperationMode): Promise<ActualFinancialOperationResult> {
  const result = await callActual<ActualFinancialOperationResult>("reconcileFinancialOperation", [userId, input, mode], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export async function markBillPaid(scheduleId: string, userId: string): Promise<unknown> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    return markBillPaidInner(scheduleId, userId);
  });
}

export async function sendBill(billData: ActualBillWriteInput, userId: string): Promise<unknown> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    return sendBillInner(billData, userId);
  });
}

export async function createQuickTxn(userId: string, payload: ActualQuickTransactionInput): Promise<ActualQuickTransactionResult> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    return createQuickTxnInner(userId, payload);
  });
}

export async function importTransactionGroups(
  userId: string,
  groups: ActualImportAccountGroup[],
  dryRun: boolean,
): Promise<ActualImportBatchResult> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    await guardCorrectedOriginalIdentity(userId, groups.flatMap(group => group.transactions.map(transaction => transaction.importedId)));
    return importTransactionGroupsInner(userId, groups, dryRun);
  });
}

export async function reconcileTransferSchedule(userId: string, input: ActualTransferScheduleInput, mode: ActualTransferScheduleMode): Promise<ActualTransferScheduleResult> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    await guardCorrectedOriginalIdentity(userId, [input.identityKey]);
    return reconcileTransferScheduleInner(userId, input, mode);
  });
}

export async function reconcileFinancialOperation(userId: string, input: ActualFinancialOperationInput, mode: ActualFinancialOperationMode): Promise<ActualFinancialOperationResult> {
  return coordinateActualWrite(async () => {
    await guardOrdinaryActualWrite(userId);
    await guardCorrectedOriginalIdentity(userId, [input.identityKey]);
    return reconcileFinancialOperationInner(userId, input, mode);
  });
}

export async function inspectCorrection(userId: string, budgetId: string, targets: CorrectionTargets): Promise<CorrectionSnapshot> {
  return callActual('inspectCorrection', [userId, budgetId, targets], WRITE_OPERATION_WORKER_OPTIONS);
}
export async function dispatchCorrection(userId: string, budgetId: string, step: CorrectionStep, expected: CorrectionSnapshot): Promise<{ localObserved?: CorrectionSnapshot; observed: CorrectionSnapshot; state: CorrectionStepStatus['state']; error: string | null }> {
  const result = await callActual<{ localObserved?: CorrectionSnapshot; observed: CorrectionSnapshot; state: CorrectionStepStatus['state']; error: string | null }>('dispatchCorrection', [userId, budgetId, step, expected], WRITE_OPERATION_WORKER_OPTIONS);
  clearMetadataCache();
  return result;
}

export { coordinateActualWrite } from './actual-write-coordination.ts';
export { correctionJson, correctionConditions, decodeCorrectionJson } from './actualCorrectionEvidence.ts';
export { observeCorrectionStep } from './actualCorrectionExecutor.ts';
export { buildDateCondition as buildCorrectionDateCondition } from './actualCoreModel.ts';
