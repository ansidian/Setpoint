// Generic, injectable graceful-shutdown sequencer (REL-03).
//
// This module knows nothing about the specific HTTP server or background
// workers it is shutting down — it is purely the *sequencing* logic, so it
// can be unit-tested without ever registering a real `process.on('SIGTERM')`
// handler (which is untestable inside Vitest; see server/scheduler.ts's
// VITEST/NODE_ENV=test gate on its own signal registration).
//
// The caller (server/index.js) is responsible for constructing this with the
// real `server` instance and the real list of `stopFns`, and for registering
// the actual signal handlers that call `shutdown(signal)`.

export interface ShutdownServer {
  close: (callback: () => void) => void;
  closeAllConnections?: () => void;
}

export type ShutdownStopFn = () => unknown | PromiseLike<unknown>;
export type ShutdownExit = (code: number) => void;
export type ShutdownLogger = (...args: unknown[]) => void;

export interface GracefulShutdownOptions {
  server: ShutdownServer;
  stopFns?: ShutdownStopFn[];
  forceExitMs?: number;
  exit?: ShutdownExit;
  log?: ShutdownLogger;
}

export function createGracefulShutdown({
  server,
  stopFns = [],
  forceExitMs = 15_000,
  exit = process.exit,
  log = console.log,
}: GracefulShutdownOptions): { shutdown: (signal: string) => Promise<void> } {
  let shutdownInFlight: Promise<void> | null = null;

  function closeServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  async function runStopFns(): Promise<void> {
    for (const stopFn of stopFns) {
      try {
        await stopFn();
      } catch (err: unknown) {
        log(`[Shutdown] stopFn failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function runShutdown(signal: string): Promise<void> {
    log(`[Shutdown] Received ${signal} — draining before exit`);

    const forceExitTimer = setTimeout(() => {
      log(`[Shutdown] Force-exit after ${forceExitMs}ms — drain did not complete in time`);
      exit(1);
    }, forceExitMs);
    forceExitTimer.unref?.();

    let closeAllConnectionsTimer = null;
    if (typeof server.closeAllConnections === "function") {
      const closeAllConnections = server.closeAllConnections;
      const closeAllConnectionsDelay = Math.min(8_000, forceExitMs / 2);
      closeAllConnectionsTimer = setTimeout(() => {
        closeAllConnections();
      }, closeAllConnectionsDelay);
      closeAllConnectionsTimer.unref?.();
    }

    await closeServer();
    await runStopFns();

    clearTimeout(forceExitTimer);
    if (closeAllConnectionsTimer !== null) clearTimeout(closeAllConnectionsTimer);
    exit(0);
  }

  function shutdown(signal: string): Promise<void> {
    if (shutdownInFlight) return shutdownInFlight;
    shutdownInFlight = runShutdown(signal);
    return shutdownInFlight;
  }

  return { shutdown };
}
