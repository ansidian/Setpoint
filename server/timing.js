const TIMING_PREFIX = "[EA Timing]";

function cleanTimingFields(fields) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        key === "ms" && Number.isFinite(value) ? Math.round(value) : value,
      ]),
  );
}

export function formatTimingLog(fields) {
  return `${TIMING_PREFIX} ${JSON.stringify(cleanTimingFields(fields))}`;
}

export function logTiming(fields, logger = console.log) {
  logger(formatTimingLog(fields));
}

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
