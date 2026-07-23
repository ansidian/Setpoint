import { afterEach, describe, expect, it, vi } from "vitest";

const workerMock = vi.hoisted(() => ({
  recoverAbandonedHistoricalRuns: vi.fn().mockResolvedValue({}),
  recoverStaleClaims: vi.fn().mockResolvedValue({}),
  processNextHistoricalPage: vi.fn(),
  processNextItemBatch: vi.fn().mockResolvedValue(false),
}));

vi.mock("./transaction-import-worker.ts", () => ({ transactionImportWorker: workerMock }));

describe("transaction import runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
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
    const runtime = await import("./transaction-import-runtime.ts");

    await runtime.startTransactionImportWorker();
    await vi.advanceTimersByTimeAsync(0);
    await pageStarted;
    let stopped = false;
    const stopping = runtime.stopTransactionImportWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);

    runtime.requestTransactionImportDrain();
    await vi.advanceTimersByTimeAsync(0);
    expect(workerMock.processNextHistoricalPage).toHaveBeenCalledTimes(1);
  });

  it("reclaims abandoned Gmail scans at startup and keeps checking stale claims", async () => {
    vi.useFakeTimers();
    workerMock.processNextHistoricalPage.mockResolvedValue(false);
    const runtime = await import("./transaction-import-runtime.ts");

    await runtime.startTransactionImportWorker();
    expect(workerMock.recoverAbandonedHistoricalRuns).toHaveBeenCalledTimes(1);
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(workerMock.recoverStaleClaims).toHaveBeenCalledTimes(3);

    await runtime.stopTransactionImportWorker();
  });
});
