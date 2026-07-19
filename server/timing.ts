import * as sharedTiming from "../shared/timing.ts";
import type { RequestHandler } from "express";
import type { TimingFields } from "../shared/timing.ts";

export const logTiming = sharedTiming.logTiming;

export function getElapsedMs(startedAt: number): number {
  return performance.now() - startedAt;
}

export function timeRoute(route: string): RequestHandler {
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

export async function timeAsync<T>(
  phase: string,
  fn: () => T | PromiseLike<T>,
  extra: TimingFields = {},
): Promise<T> {
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
  } catch (err: unknown) {
    logTiming({
      event: "boot",
      phase,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      ...extra,
    }, console.error);
    throw err;
  }
}
