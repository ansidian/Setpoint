import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  type ShutdownServer,
  type ShutdownStopFn,
} from "./shutdown.ts";

function makeServer({
  closeBehavior = "immediate",
  hasCloseAllConnections = true,
}: {
  closeBehavior?: "immediate" | "never";
  hasCloseAllConnections?: boolean;
} = {}) {
  const state = { closeCount: 0, closeAllConnectionsCount: 0 };
  const server: ShutdownServer = {
    close: (callback) => {
      state.closeCount += 1;
      if (closeBehavior === "immediate") callback();
    },
  };
  if (hasCloseAllConnections) {
    server.closeAllConnections = () => { state.closeAllConnectionsCount += 1; };
  }
  return { server, state };
}

function captureShutdownEffects() {
  const exitCodes: number[] = [];
  const messages: string[] = [];
  return {
    exitCodes,
    messages,
    exit: (code: number) => { exitCodes.push(code); },
    log: (...args: unknown[]) => { messages.push(args.map(String).join(" ")); },
  };
}

describe("createGracefulShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the server, runs all stopFns in order, then exits 0", async () => {
    const { server, state } = makeServer();
    const order: string[] = [];
    const stopFns = [
      async () => { order.push("stop1"); },
      async () => { order.push("stop2"); },
    ];
    const effects = captureShutdownEffects();

    await createGracefulShutdown({ server, stopFns, ...effects }).shutdown("SIGTERM");

    expect(state.closeCount).toBe(1);
    expect(order).toEqual(["stop1", "stop2"]);
    expect(effects.exitCodes).toEqual([0]);
  });

  it("continues running later stopFns and still exits 0 when one stopFn rejects", async () => {
    const { server } = makeServer();
    const order: string[] = [];
    const stopFns = [
      async () => {
        order.push("stop1");
        throw new Error("stop1 boom");
      },
      async () => { order.push("stop2"); },
    ];
    const effects = captureShutdownEffects();

    await createGracefulShutdown({ server, stopFns, ...effects }).shutdown("SIGTERM");

    expect(order).toEqual(["stop1", "stop2"]);
    expect(effects.exitCodes).toEqual([0]);
    expect(effects.messages.join(" ")).toContain("stop1 boom");
  });

  it("is idempotent: a second call while in flight does not re-run stopFns", async () => {
    const { server, state } = makeServer();
    let resolveStop: (() => void) | undefined;
    let stopCount = 0;
    const stop = () => {
      stopCount += 1;
      return new Promise<void>((resolve) => { resolveStop = resolve; });
    };
    const effects = captureShutdownEffects();
    const { shutdown } = createGracefulShutdown({ server, stopFns: [stop], ...effects });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(first).toBe(second);
    expect(stopCount).toBe(1);
    expect(state.closeCount).toBe(1);

    resolveStop?.();
    await first;
    await second;
    expect(effects.exitCodes).toEqual([0]);

    const third = shutdown("SIGTERM");
    expect(third).toBe(first);
    await third;
    expect(stopCount).toBe(1);
  });

  it("force-exits with code 1 after forceExitMs when server.close never calls back", async () => {
    const { server } = makeServer({ closeBehavior: "never" });
    let stopCount = 0;
    const effects = captureShutdownEffects();
    const forceExitMs = 15_000;

    const pending = createGracefulShutdown({
      server,
      stopFns: [async () => { stopCount += 1; }],
      forceExitMs,
      ...effects,
    }).shutdown("SIGTERM");

    expect(effects.exitCodes).toEqual([]);
    await vi.advanceTimersByTimeAsync(forceExitMs);

    expect(effects.exitCodes).toEqual([1]);
    expect(effects.messages.join(" ")).toContain("Force-exit");
    expect(stopCount).toBe(0);
    void pending;
  });

  it("force-exits when a scheduler drain remains pending after the server closes", async () => {
    const { server } = makeServer();
    let stopCount = 0;
    const effects = captureShutdownEffects();
    const forceExitMs = 15_000;

    const pending = createGracefulShutdown({
      server,
      stopFns: [() => {
        stopCount += 1;
        return new Promise<void>(() => {});
      }],
      forceExitMs,
      ...effects,
    }).shutdown("SIGTERM");

    await vi.advanceTimersByTimeAsync(0);
    expect(stopCount).toBe(1);
    expect(effects.exitCodes).toEqual([]);

    await vi.advanceTimersByTimeAsync(forceExitMs);
    expect(effects.exitCodes).toEqual([1]);
    expect(effects.messages.join(" ")).toContain("Force-exit");
    void pending;
  });

  it("calls closeAllConnections after min(8000, forceExitMs/2) ms if the server exposes it", async () => {
    const { server, state } = makeServer({ closeBehavior: "never" });
    const stopFns: ShutdownStopFn[] = [];
    const effects = captureShutdownEffects();
    const forceExitMs = 15_000;

    createGracefulShutdown({ server, stopFns, forceExitMs, ...effects }).shutdown("SIGTERM");

    await vi.advanceTimersByTimeAsync(7_499);
    expect(state.closeAllConnectionsCount).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.closeAllConnectionsCount).toBe(1);
  });

  it("clears the closeAllConnections timer on a fast/clean shutdown so it never fires later", async () => {
    const { server, state } = makeServer();
    const effects = captureShutdownEffects();
    const forceExitMs = 15_000;
    const { shutdown } = createGracefulShutdown({ server, stopFns: [], forceExitMs, ...effects });

    await shutdown("SIGTERM");

    expect(effects.exitCodes).toEqual([0]);
    expect(state.closeAllConnectionsCount).toBe(0);

    await vi.advanceTimersByTimeAsync(Math.min(8_000, forceExitMs / 2));
    expect(state.closeAllConnectionsCount).toBe(0);
  });
});
