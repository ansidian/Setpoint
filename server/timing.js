import * as sharedTiming from "../shared/timing.ts";

export const formatTimingLog = sharedTiming.formatTimingLog;
export const logTiming = sharedTiming.logTiming;

export function getElapsedMs(startedAt) {
  return performance.now() - startedAt;
}

export function timeRoute(route) {
  return (_req, res, next) => {
    const startedAt = performance.now();
    res.once("finish", () => {
      logTiming({
        event: "request",
        route,
        ms: getElapsedMs(startedAt),
        status: res.statusCode,
        degraded: res.locals?.eaTiming?.degraded,
      });
    });
    next();
  };
}

export async function timeAsync(phase, fn, extra = {}) {
  const startedAt = performance.now();
  try {
    const result = await fn();
    logTiming({
      event: "boot",
      phase,
      ms: getElapsedMs(startedAt),
      status: "ok",
      ...extra,
    });
    return result;
  } catch (err) {
    logTiming({
      event: "boot",
      phase,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err?.message || String(err),
      ...extra,
    }, console.error);
    throw err;
  }
}
