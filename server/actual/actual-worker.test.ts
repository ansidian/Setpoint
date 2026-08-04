import { EventEmitter } from "events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

interface TestChild extends EventEmitter {
  stderr: EventEmitter;
  stdout: EventEmitter;
  send: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

const forkMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { fork: forkMock },
  fork: forkMock,
}));

const {
  runActualWorkerOperation,
  shutdownActualWorker,
} = await import("./actual-worker.ts");

function createChild(): TestChild {
  const child = new EventEmitter() as TestChild;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.send = vi.fn();
  child.kill = vi.fn();
  return child;
}

describe("Actual worker runner", () => {
  beforeEach(() => {
    shutdownActualWorker();
    forkMock.mockReset();
  });

  afterEach(() => {
    shutdownActualWorker();
    vi.useRealTimers();
    delete process.env.EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS;
    delete process.env.EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB;
    process.env.NODE_ENV = "test";
  });

  it("resolves with the worker result", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const request = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: request.id,
      ok: true,
      result: { accounts: [{ id: "acct-1" }] },
    });

    await expect(resultPromise).resolves.toEqual({ accounts: [{ id: "acct-1" }] });
    expect(request).toMatchObject({
      operation: "getMetadata",
      args: ["user-1"],
    });
  });

  it("reuses one worker and serializes operations", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const first = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    const second = runActualWorkerOperation("getPayees", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- child.send is the process IPC boundary; only one request may be admitted before the active request completes.
    expect(child.send).toHaveBeenCalledTimes(1);

    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const firstRequest = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: firstRequest.id,
      ok: true,
      result: { accounts: [] },
    });
    await expect(first).resolves.toEqual({ accounts: [] });

    // test-architecture: allow-boundary-interaction -- child.send is the process IPC boundary; completion must admit exactly the queued follow-up request.
    expect(child.send).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const secondRequest = child.send.mock.calls[1]![0];
    child.emit("message", {
      id: secondRequest.id,
      ok: true,
      result: [{ id: "payee-1" }],
    });

    await expect(second).resolves.toEqual([{ id: "payee-1" }]);
  });

  it("rejects with a 502 when the worker exits before responding", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    child.stderr.emit("data", "FATAL ERROR: Reached heap limit");
    child.emit("exit", 134, null);

    await expect(resultPromise).rejects.toMatchObject({
      status: 502,
      code: "ACTUAL_WORKER_EXITED",
      message: expect.stringContaining("status 134"),
    });
  });

  it("starts a fresh worker after a crash", async () => {
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const first = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    firstChild.emit("exit", 134, null);
    await expect(first).rejects.toMatchObject({ code: "ACTUAL_WORKER_EXITED" });

    const second = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const secondRequest = secondChild.send.mock.calls[0]![0];
    secondChild.emit("message", {
      id: secondRequest.id,
      ok: true,
      result: { accounts: [] },
    });

    await expect(second).resolves.toEqual({ accounts: [] });
  });

  it("shuts down an idle worker after the configured idle window", async () => {
    vi.useFakeTimers();
    process.env.EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS = "25";
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const request = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: request.id,
      ok: true,
      result: { accounts: [] },
    });
    await expect(resultPromise).resolves.toEqual({ accounts: [] });

    // test-architecture: allow-boundary-interaction -- child.kill is the process lifecycle boundary; the reusable worker must remain alive before its idle deadline.
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    // test-architecture: allow-boundary-interaction -- child.kill is the process lifecycle boundary; idle expiry must request graceful SIGTERM shutdown.
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", null, "SIGTERM");
  });

  it("shuts down the worker immediately when an operation opts out of reuse", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("sendBill", [{ amount: 10 }, "user-1"], {
      shutdownAfterOperation: true,
      timeoutMs: 1000,
    });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const request = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: request.id,
      ok: true,
      result: { success: true },
    });

    await expect(resultPromise).resolves.toEqual({ success: true });
    // test-architecture: allow-boundary-interaction -- child.kill is the process lifecycle boundary; shutdownAfterOperation must request SIGTERM immediately after the response.
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", null, "SIGTERM");
  });

  it("discards and force-kills a timed-out worker before the next operation", async () => {
    vi.useFakeTimers();
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const first = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 25 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    await expect(first).rejects.toMatchObject({
      status: 504,
      code: "ACTUAL_WORKER_TIMEOUT",
    });
    // test-architecture: allow-boundary-interaction -- child.kill is the process lifecycle boundary; a timed-out worker must receive SIGTERM before replacement work is admitted.
    expect(firstChild.kill).toHaveBeenCalledWith("SIGTERM");

    const second = runActualWorkerOperation("getPayees", ["user-1"], { timeoutMs: 5000 });
    await Promise.resolve();
    // test-architecture: allow-boundary-interaction -- secondChild.send is the replacement-process IPC boundary; recovery must admit the next request without waiting for force-kill grace.
    expect(secondChild.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    // test-architecture: allow-boundary-interaction -- child.kill is the process lifecycle boundary; an unresponsive timed-out worker must escalate to SIGKILL after grace.
    expect(firstChild.kill).toHaveBeenCalledWith("SIGKILL");

    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const secondRequest = secondChild.send.mock.calls[0]![0];
    secondChild.emit("message", {
      id: secondRequest.id,
      ok: true,
      result: [],
    });
    await expect(second).resolves.toEqual([]);
  });

  it("caps production worker heap by default", async () => {
    process.env.NODE_ENV = "production";
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();

    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    expect(forkMock.mock.calls[0]![2]!.execArgv).toEqual(["--max-old-space-size=192"]);
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const request = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: request.id,
      ok: true,
      result: { accounts: [] },
    });
    await expect(resultPromise).resolves.toEqual({ accounts: [] });
  });

  it("allows an explicit worker heap cap override", async () => {
    process.env.NODE_ENV = "production";
    process.env.EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB = "128";
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();

    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    expect(forkMock.mock.calls[0]![2]!.execArgv).toEqual(["--max-old-space-size=128"]);
    // test-architecture: allow-boundary-interaction -- Actual worker IPC and fork configuration are process boundaries; request correlation, replacement, and memory ceilings are observable only on child messages and fork options.
    const request = child.send.mock.calls[0]![0];
    child.emit("message", {
      id: request.id,
      ok: true,
      result: { accounts: [] },
    });
    await expect(resultPromise).resolves.toEqual({ accounts: [] });
  });
});
