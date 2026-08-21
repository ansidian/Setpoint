import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransactionImportRuntime } from "./transaction-import-runtime.ts";

const workerMock = vi.hoisted(() => ({
  recoverAbandonedHistoricalRuns: vi.fn().mockResolvedValue({}),
  recoverStaleClaims: vi.fn().mockResolvedValue({}),
  processNextHistoricalPage: vi.fn(),
  processNextItemBatch: vi.fn().mockResolvedValue(false),
  getNextWakeAt: vi.fn().mockResolvedValue(null),
}));

async function flushDrain(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

describe("transaction import runtime", () => {
  beforeEach(() => {
    workerMock.recoverAbandonedHistoricalRuns.mockReset().mockResolvedValue({});
    workerMock.recoverStaleClaims.mockReset().mockResolvedValue({});
    workerMock.processNextHistoricalPage.mockReset().mockResolvedValue(false);
    workerMock.processNextItemBatch.mockReset().mockResolvedValue(false);
    workerMock.getNextWakeAt.mockReset().mockResolvedValue(null);
  });

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
    await vi.advanceTimersToNextTimerAsync();
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

  it("reclaims abandoned Gmail scans at startup without polling an idle queue every 30 seconds", async () => {
    vi.useFakeTimers();
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    // test-architecture: allow-boundary-interaction -- Startup recovery is a durable worker boundary; abandoned historical scans must be reclaimed exactly once before interval admission.
    expect(workerMock.recoverAbandonedHistoricalRuns).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Stale-claim recovery is a durable worker boundary; startup must perform the initial recovery before scheduling later sweeps.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();

    await vi.advanceTimersByTimeAsync(299_999);
    // test-architecture: allow-boundary-interaction -- Idle runtime admission is the behavior under test; no legacy 30-second process wake may reach the durable worker boundary.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- Stale recovery is now a sparse safety boundary, so an idle runtime must not re-run it before five minutes.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- The five-minute safety boundary must still recover stale claims and admit one durable queue check.
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- The safety pass remains a real queue backstop even when no in-process admission signal arrives.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);

    await runtime.stop();
  });

  it("wakes at the earliest durable retry timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    workerMock.getNextWakeAt
      .mockResolvedValueOnce(61_000)
      .mockResolvedValueOnce(null);
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();
    await vi.advanceTimersByTimeAsync(59_999);
    // test-architecture: allow-boundary-interaction -- A future durable retry is a timer/process boundary; it must not be claimed before its stored timestamp.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- Reaching the stored retry timestamp must admit exactly one follow-up drain without waiting for the safety backstop.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);

    await runtime.stop();
  });

  it("keeps bounded 30-second pacing only after a drain exhausts its work cap", async () => {
    vi.useFakeTimers();
    workerMock.processNextHistoricalPage
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const runtime = createTransactionImportRuntime(workerMock);

    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- The bounded worker contract permits five historical pages in one drain and must stop at that cap.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(29_999);
    // test-architecture: allow-boundary-interaction -- The saturated-drain boundary must remain quiet until its full pacing delay has elapsed.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersToNextTimerAsync();
    await flushDrain();
    // test-architecture: allow-boundary-interaction -- Saturated work, unlike idle state, must retain the existing 30-second follow-up pacing.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(6);

    await runtime.stop();
  });

  it("does not lose an immediate wake requested during an active drain", async () => {
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
    runtime.requestDrain();
    release();
    await vi.advanceTimersByTimeAsync(0);

    // test-architecture: allow-boundary-interaction -- A queue-admission signal racing an active background drain must produce a second durable pass instead of being dropped.
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });
});
