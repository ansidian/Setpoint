import { EventEmitter } from "events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const forkMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { fork: forkMock },
  fork: forkMock,
}));

const {
  getActualWorkerHealth,
  runActualWorkerOperation,
  shutdownActualWorkerForTests,
} = await import("./actual-worker.js");

function createChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.send = vi.fn();
  child.kill = vi.fn();
  return child;
}

describe("Actual worker runner", () => {
  beforeEach(() => {
    shutdownActualWorkerForTests();
    forkMock.mockReset();
  });

  afterEach(() => {
    shutdownActualWorkerForTests();
  });

  it("resolves with the worker result", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    await Promise.resolve();
    const request = child.send.mock.calls[0][0];
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
    expect(child.send).toHaveBeenCalledTimes(1);

    const firstRequest = child.send.mock.calls[0][0];
    child.emit("message", {
      id: firstRequest.id,
      ok: true,
      result: { accounts: [] },
    });
    await expect(first).resolves.toEqual({ accounts: [] });

    expect(child.send).toHaveBeenCalledTimes(2);
    const secondRequest = child.send.mock.calls[1][0];
    child.emit("message", {
      id: secondRequest.id,
      ok: true,
      result: [{ id: "payee-1" }],
    });

    await expect(second).resolves.toEqual([{ id: "payee-1" }]);
    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(getActualWorkerHealth()).toMatchObject({
      state: "idle",
      inFlight: 0,
    });
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
    const secondRequest = secondChild.send.mock.calls[0][0];
    secondChild.emit("message", {
      id: secondRequest.id,
      ok: true,
      result: { accounts: [] },
    });

    await expect(second).resolves.toEqual({ accounts: [] });
    expect(forkMock).toHaveBeenCalledTimes(2);
  });
});
