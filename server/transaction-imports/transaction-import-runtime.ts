import { transactionImportWorker } from "./transaction-import-worker.ts";

const SATURATED_DRAIN_RECHECK_MS = 30_000;
const SAFETY_BACKSTOP_MS = 5 * 60_000;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_RUN_PAGES_PER_DRAIN = 5;
const MAX_ITEM_BATCHES_PER_DRAIN = 10;

type TransactionImportWorker = Pick<typeof transactionImportWorker,
  | "recoverAbandonedHistoricalRuns"
  | "recoverStaleClaims"
  | "processNextHistoricalPage"
  | "processNextItemBatch"
  | "getNextWakeAt"
>;

export function createTransactionImportRuntime(worker: TransactionImportWorker) {
  let safetyInterval: ReturnType<typeof setInterval> | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeAt: number | null = null;
  let immediate: ReturnType<typeof setImmediate> | null = null;
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;
  let recoveryRequested = false;
  let stopping = false;

  function clearWakeTimer(): void {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = null;
    wakeAt = null;
  }

  function scheduleDrainAt(requestedAt: number): void {
    if (stopping || !Number.isFinite(requestedAt)) return;
    if (wakeAt != null && wakeAt <= requestedAt) return;
    clearWakeTimer();
    wakeAt = requestedAt;
    const delayMs = Math.min(Math.max(0, requestedAt - Date.now()), MAX_TIMER_MS);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      wakeAt = null;
      requestDrain();
    }, delayMs);
    wakeTimer.unref?.();
  }

  async function drainBounded(
    limit: number,
    processNext: () => Promise<boolean>,
  ): Promise<boolean> {
    for (let index = 0; index < limit && !stopping; index++) {
      if (!await processNext()) return false;
    }
    return !stopping;
  }

  async function drain(): Promise<void> {
    if (stopping || inFlight) return inFlight || Promise.resolve();
    inFlight = (async () => {
      if (recoveryRequested) {
        recoveryRequested = false;
        await worker.recoverStaleClaims();
      }
      const historicalSaturated = await drainBounded(
        MAX_RUN_PAGES_PER_DRAIN,
        worker.processNextHistoricalPage,
      );
      const itemsSaturated = await drainBounded(
        MAX_ITEM_BATCHES_PER_DRAIN,
        worker.processNextItemBatch,
      );
      if (stopping) return;
      if (historicalSaturated || itemsSaturated) {
        scheduleDrainAt(Date.now() + SATURATED_DRAIN_RECHECK_MS);
        return;
      }
      const nextWakeAt = await worker.getNextWakeAt();
      if (nextWakeAt != null) {
        scheduleDrainAt(nextWakeAt <= Date.now()
          ? Date.now() + SATURATED_DRAIN_RECHECK_MS
          : nextWakeAt);
      }
    })().catch((error) => {
      console.error("[Transaction Imports] Worker drain failed:", error instanceof Error ? error.message : String(error));
    }).finally(() => {
      inFlight = null;
      if (!stopping && rerunRequested) {
        rerunRequested = false;
        requestDrain();
      }
    });
    return inFlight;
  }

  function requestDrain(): void {
    if (stopping) return;
    clearWakeTimer();
    if (inFlight) {
      rerunRequested = true;
      return;
    }
    if (immediate) return;
    immediate = setImmediate(() => {
      immediate = null;
      void drain();
    });
    immediate.unref?.();
  }

  async function start(): Promise<void> {
    stopping = false;
    await worker.recoverAbandonedHistoricalRuns();
    await worker.recoverStaleClaims();
    if (safetyInterval) clearInterval(safetyInterval);
    safetyInterval = setInterval(() => {
      recoveryRequested = true;
      requestDrain();
    }, SAFETY_BACKSTOP_MS);
    safetyInterval.unref?.();
    requestDrain();
  }

  async function stop(): Promise<void> {
    stopping = true;
    if (safetyInterval) clearInterval(safetyInterval);
    safetyInterval = null;
    clearWakeTimer();
    if (immediate) clearImmediate(immediate);
    immediate = null;
    rerunRequested = false;
    recoveryRequested = false;
    await inFlight;
  }

  return { requestDrain, start, stop };
}

const runtime = createTransactionImportRuntime(transactionImportWorker);

export const requestTransactionImportDrain = runtime.requestDrain;
export const startTransactionImportWorker = runtime.start;
export const stopTransactionImportWorker = runtime.stop;
