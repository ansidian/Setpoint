// Generic, injectable graceful-shutdown sequencer (REL-03).
//
// This module knows nothing about the specific HTTP server or background
// workers it is shutting down — it is purely the *sequencing* logic, so it
// can be unit-tested without ever registering a real `process.on('SIGTERM')`
// handler (which is untestable inside Vitest; see server/scheduler.js's
// VITEST/NODE_ENV=test gate on its own signal registration).
//
// The caller (server/index.js) is responsible for constructing this with the
// real `server` instance and the real list of `stopFns`, and for registering
// the actual signal handlers that call `shutdown(signal)`.

/**
 * @param {object} opts
 * @param {import("http").Server} opts.server - server exposing close([cb]) and optionally closeAllConnections()
 * @param {Array<() => Promise<void> | void>} [opts.stopFns] - background-worker stop functions, run sequentially
 * @param {number} [opts.forceExitMs] - deadline after which shutdown force-exits even if stuck
 * @param {(code: number) => void} [opts.exit] - injectable process.exit
 * @param {(...args: any[]) => void} [opts.log] - injectable logger
 * @returns {{ shutdown: (signal: string) => Promise<void> }}
 */
export function createGracefulShutdown({
  server,
  stopFns = [],
  forceExitMs = 15_000,
  exit = process.exit,
  log = console.log,
}) {
  let shutdownInFlight = null;

  function closeServer() {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  async function runStopFns() {
    for (const stopFn of stopFns) {
      try {
        await stopFn();
      } catch (err) {
        log(`[Shutdown] stopFn failed: ${err?.message || err}`);
      }
    }
  }

  async function runShutdown(signal) {
    log(`[Shutdown] Received ${signal} — draining before exit`);

    const forceExitTimer = setTimeout(() => {
      log(`[Shutdown] Force-exit after ${forceExitMs}ms — drain did not complete in time`);
      exit(1);
    }, forceExitMs);
    forceExitTimer.unref?.();

    let closeAllConnectionsTimer = null;
    if (typeof server.closeAllConnections === "function") {
      const closeAllConnectionsDelay = Math.min(8_000, forceExitMs / 2);
      closeAllConnectionsTimer = setTimeout(() => {
        server.closeAllConnections();
      }, closeAllConnectionsDelay);
      closeAllConnectionsTimer.unref?.();
    }

    await closeServer();
    await runStopFns();

    clearTimeout(forceExitTimer);
    clearTimeout(closeAllConnectionsTimer);
    exit(0);
  }

  function shutdown(signal) {
    if (shutdownInFlight) return shutdownInFlight;
    shutdownInFlight = runShutdown(signal);
    return shutdownInFlight;
  }

  return { shutdown };
}
