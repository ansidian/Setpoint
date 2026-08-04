import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransactionImportRuntime } from "./transaction-import-runtime.ts";

const workerMock = vi.hoisted(() => ({
  recoverAbandonedHistoricalRuns: vi.fn().mockResolvedValue({}),
  recoverStaleClaims: vi.fn().mockResolvedValue({}),
  processNextHistoricalPage: vi.fn(),
  processNextItemBatch: vi.fn().mockResolvedValue(false),
}));

describe("transaction import runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stops admission and waits for in-flight work before shutdown completes", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pageStarted = new Promise<void>((resolve) => {
      workerMock.processNextHistoricalPage.mockImplementationOnce(() => new Promise<boolean>((done) => {
        release = () => done(false);
        resolve();
      }));
    });
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await pageStarted;
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);

    runtime.requestDrain();
    await vi.advanceTimersByTimeAsync(0);
    // test-architecture: allow-boundary-interaction -- Worker admission is a background-process boundary; after stop, a new drain request must not admit a second durable worker pass.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);
  });

  it("reclaims abandoned Gmail scans at startup and keeps checking stale claims", async () => {
    vi.useFakeTimers();
    workerMock.processNextHistoricalPage.mockResolvedValue(false);
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    // test-architecture: allow-boundary-interaction -- Startup recovery is a durable worker boundary; abandoned historical scans must be reclaimed exactly once before interval admission.
    expect(workerMock.recoverAbandonedHistoricalRuns).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Stale-claim recovery is a durable worker boundary; startup must perform the initial recovery before scheduling later sweeps.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    // test-architecture: allow-boundary-interaction -- The timer/process boundary must admit the immediate drain and one interval drain in addition to startup recovery.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(3);

    await runtime.stop();
  });
});
