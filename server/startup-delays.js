const PRODUCTION_STARTUP_DELAY_MS = 60_000;
const PRODUCTION_STARTUP_JITTER_MS = 60_000;
const PRODUCTION_INDEXER_OFFSET_MS = 120_000;
const PRODUCTION_BACKFILL_OFFSET_MS = 600_000;
const PRODUCTION_TODOIST_SYNC_OFFSET_MS = 0;
const PRODUCTION_BILLS_MIRROR_OFFSET_MS = 30_000;

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function calculateStartupDelayMs({ baseMs, jitterMs, random = Math.random }) {
  return baseMs + Math.floor(jitterMs * random());
}

export function buildStartupWorkerDelays(env = process.env, random = Math.random) {
  const isProduction = env.NODE_ENV === "production";
  const baseMs = parseNonNegativeInt(
    env.EA_STARTUP_WORKER_DELAY_MS,
    isProduction ? PRODUCTION_STARTUP_DELAY_MS : 0,
  );
  const jitterMs = parseNonNegativeInt(
    env.EA_STARTUP_WORKER_JITTER_MS,
    isProduction ? PRODUCTION_STARTUP_JITTER_MS : 0,
  );
  const delayMs = calculateStartupDelayMs({ baseMs, jitterMs, random });
  const indexerOffsetMs = parseNonNegativeInt(
    env.EA_STARTUP_INDEXER_OFFSET_MS,
    isProduction ? PRODUCTION_INDEXER_OFFSET_MS : 0,
  );
  const backfillOffsetMs = parseNonNegativeInt(
    env.EA_STARTUP_BACKFILL_OFFSET_MS,
    isProduction ? PRODUCTION_BACKFILL_OFFSET_MS : 0,
  );
  const todoistSyncOffsetMs = parseNonNegativeInt(
    env.EA_STARTUP_TODOIST_SYNC_OFFSET_MS,
    isProduction ? PRODUCTION_TODOIST_SYNC_OFFSET_MS : 0,
  );
  const billsMirrorOffsetMs = parseNonNegativeInt(
    env.EA_STARTUP_BILLS_MIRROR_OFFSET_MS,
    isProduction ? PRODUCTION_BILLS_MIRROR_OFFSET_MS : 0,
  );

  return {
    scheduler: delayMs,
    indexer: delayMs + indexerOffsetMs,
    backfill: delayMs + backfillOffsetMs,
    snooze: delayMs,
    todoistSync: delayMs + todoistSyncOffsetMs,
    billsMirror: delayMs + billsMirrorOffsetMs,
  };
}
