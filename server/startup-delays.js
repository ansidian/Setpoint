const PRODUCTION_STARTUP_DELAY_MS = 60_000;
const PRODUCTION_STARTUP_JITTER_MS = 60_000;

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

  return {
    scheduler: delayMs,
    indexer: delayMs,
    backfill: delayMs,
    snooze: delayMs,
  };
}
