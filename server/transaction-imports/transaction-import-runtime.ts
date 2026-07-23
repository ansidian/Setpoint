import { transactionImportWorker } from "./transaction-import-worker.ts";

const DRAIN_INTERVAL_MS = 30_000;
const MAX_RUN_PAGES_PER_DRAIN = 5;
const MAX_ITEM_BATCHES_PER_DRAIN = 10;

let interval: ReturnType<typeof setInterval> | null = null;
let immediate: ReturnType<typeof setImmediate> | null = null;
let inFlight: Promise<void> | null = null;
let stopping = false;

async function drain(): Promise<void> {
  if (stopping || inFlight) return inFlight || Promise.resolve();
  inFlight = (async () => {
    await transactionImportWorker.recoverStaleClaims();
    for (let index = 0; index < MAX_RUN_PAGES_PER_DRAIN && !stopping; index++) {
      if (!await transactionImportWorker.processNextHistoricalPage()) break;
    }
    for (let index = 0; index < MAX_ITEM_BATCHES_PER_DRAIN && !stopping; index++) {
      if (!await transactionImportWorker.processNextItemBatch()) break;
    }
  })().catch((error) => {
    console.error("[Transaction Imports] Worker drain failed:", error instanceof Error ? error.message : String(error));
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function requestTransactionImportDrain(): void {
  if (stopping || immediate) return;
  immediate = setImmediate(() => {
    immediate = null;
    void drain();
  });
  immediate.unref?.();
}

export async function startTransactionImportWorker(): Promise<void> {
  stopping = false;
  await transactionImportWorker.recoverAbandonedHistoricalRuns();
  await transactionImportWorker.recoverStaleClaims();
  if (interval) clearInterval(interval);
  interval = setInterval(() => void drain(), DRAIN_INTERVAL_MS);
  interval.unref?.();
  requestTransactionImportDrain();
}

export async function stopTransactionImportWorker(): Promise<void> {
  stopping = true;
  if (interval) clearInterval(interval);
  interval = null;
  if (immediate) clearImmediate(immediate);
  immediate = null;
  await inFlight;
}
