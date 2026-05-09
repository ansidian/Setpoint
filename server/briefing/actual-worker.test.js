import { EventEmitter } from "events";
import { describe, expect, it, vi, beforeEach } from "vitest";

const forkMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { fork: forkMock },
  fork: forkMock,
}));

const { runActualWorkerOperation } = await import("./actual-worker.js");

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
    forkMock.mockReset();
  });

  it("resolves with the worker result", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
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

  it("rejects with a 502 when the worker exits before responding", async () => {
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const resultPromise = runActualWorkerOperation("getMetadata", ["user-1"], { timeoutMs: 1000 });
    child.stderr.emit("data", "FATAL ERROR: Reached heap limit");
    child.emit("exit", 134, null);

    await expect(resultPromise).rejects.toMatchObject({
      status: 502,
      code: "ACTUAL_WORKER_EXITED",
      message: expect.stringContaining("status 134"),
    });
  });
});
