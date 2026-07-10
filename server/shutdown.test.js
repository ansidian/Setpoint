import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "./shutdown.js";

function makeServer({ closeBehavior = "immediate", hasCloseAllConnections = true } = {}) {
  const closeAllConnections = vi.fn();
  const server = {
    close: vi.fn((cb) => {
      if (closeBehavior === "immediate") {
        cb();
      }
      // "never" behavior: cb is never invoked, simulating a stuck drain.
    }),
  };
  if (hasCloseAllConnections) {
    server.closeAllConnections = closeAllConnections;
  }
  return { server, closeAllConnections };
}

describe("createGracefulShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the server, runs all stopFns in order, then exits 0", async () => {
    const { server } = makeServer();
    const order = [];
    const stopFns = [
      vi.fn(async () => {
        order.push("stop1");
      }),
      vi.fn(async () => {
        order.push("stop2");
      }),
    ];
    const exit = vi.fn();
    const log = vi.fn();

    const { shutdown } = createGracefulShutdown({ server, stopFns, exit, log });

    await shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(stopFns[0]).toHaveBeenCalledTimes(1);
    expect(stopFns[1]).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["stop1", "stop2"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("continues running later stopFns and still exits 0 when one stopFn rejects", async () => {
    const { server } = makeServer();
    const order = [];
    const stopFns = [
      vi.fn(async () => {
        order.push("stop1");
        throw new Error("stop1 boom");
      }),
      vi.fn(async () => {
        order.push("stop2");
      }),
    ];
    const exit = vi.fn();
    const log = vi.fn();

    const { shutdown } = createGracefulShutdown({ server, stopFns, exit, log });

    await shutdown("SIGTERM");

    expect(order).toEqual(["stop1", "stop2"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
    // The failure must be logged, not swallowed silently.
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stop1 boom"));
  });

  it("is idempotent: a second call while in flight does not re-run stopFns", async () => {
    const { server } = makeServer();
    let resolveStop1;
    const stop1 = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveStop1 = resolve;
        }),
    );
    const stopFns = [stop1];
    const exit = vi.fn();
    const log = vi.fn();

    const { shutdown } = createGracefulShutdown({ server, stopFns, exit, log });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGTERM");

    // Let the microtask queue drain so close()'s callback (invoked
    // synchronously by our fake server) and the stopFns loop can proceed up
    // to the point where stop1's never-resolving promise blocks it.
    await vi.advanceTimersByTimeAsync(0);

    expect(first).toBe(second);
    expect(stop1).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);

    resolveStop1();
    await first;
    await second;

    expect(exit).toHaveBeenCalledTimes(1);

    // A third call, after completion, must also not re-run stopFns
    // (mirrors scheduler.js's shutdownInFlight semantics: once set, it never
    // resets on this instance) — but must still resolve without throwing.
    const third = shutdown("SIGTERM");
    expect(third).toBe(first);
    await third;
    expect(stop1).toHaveBeenCalledTimes(1);
  });

  it("force-exits with code 1 after forceExitMs when server.close never calls back", async () => {
    const { server } = makeServer({ closeBehavior: "never" });
    const stopFns = [vi.fn(async () => {})];
    const exit = vi.fn();
    const log = vi.fn();
    const forceExitMs = 15_000;

    const { shutdown } = createGracefulShutdown({ server, stopFns, forceExitMs, exit, log });

    const pending = shutdown("SIGTERM");

    // Nothing has fired yet.
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(forceExitMs);

    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Force-exit"));

    // stopFns never got the chance to run because close() never resolved.
    expect(stopFns[0]).not.toHaveBeenCalled();

    // Avoid an unhandled-rejection/dangling-promise warning from the never-
    // resolving close(); the pending promise is expected to hang forever in
    // this scenario since exit() is injected as a no-op mock (unlike the
    // real process.exit, it does not terminate execution).
    void pending;
  });

  it("calls closeAllConnections after min(8000, forceExitMs/2) ms if the server exposes it", async () => {
    const { server, closeAllConnections } = makeServer({ closeBehavior: "never" });
    const stopFns = [];
    const exit = vi.fn();
    const log = vi.fn();
    const forceExitMs = 15_000; // half is 7500, below the 8000 cap

    createGracefulShutdown({ server, stopFns, forceExitMs, exit, log }).shutdown("SIGTERM");

    await vi.advanceTimersByTimeAsync(7499);
    expect(closeAllConnections).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it("clears the closeAllConnections timer on a fast/clean shutdown so it never fires later", async () => {
    const { server, closeAllConnections } = makeServer({ closeBehavior: "immediate" });
    const stopFns = [];
    const exit = vi.fn();
    const log = vi.fn();
    const forceExitMs = 15_000; // half is 7500, below the 8000 cap

    const { shutdown } = createGracefulShutdown({ server, stopFns, forceExitMs, exit, log });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
    expect(closeAllConnections).not.toHaveBeenCalled();

    // Advance well past the closeAllConnections delay; it must not fire
    // after a clean shutdown has already completed.
    await vi.advanceTimersByTimeAsync(Math.min(8_000, forceExitMs / 2));

    expect(closeAllConnections).not.toHaveBeenCalled();
  });
});
