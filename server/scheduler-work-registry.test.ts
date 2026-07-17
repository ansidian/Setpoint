import { describe, expect, it, vi } from "vitest";
import { createSchedulerWorkRegistry } from "./scheduler-work-registry.ts";

describe("scheduler work registry", () => {
  it("waits for tracked work to settle before drain resolves", async () => {
    const registry = createSchedulerWorkRegistry();
    let resolveTask: (() => void) | undefined;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    registry.run("gmail-history", () => task);
    const drain = registry.drain();
    let drained = false;
    drain.then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    resolveTask?.();
    await drain;
    expect(drained).toBe(true);
  });

  it("shares single-flight work and permits a new run after cleanup", async () => {
    const registry = createSchedulerWorkRegistry();
    let resolveFirst: ((value: string) => void) | undefined;
    const task = vi.fn<() => Promise<string>>()
      .mockReturnValueOnce(new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce("second");

    const first = registry.run("triage", task, { singleFlight: true });
    const duplicate = registry.run("triage", task, { singleFlight: true });
    expect(duplicate).toBe(first);
    expect(task).toHaveBeenCalledTimes(1);

    resolveFirst?.("first");
    await first;
    await Promise.resolve();

    await expect(registry.run("triage", task, { singleFlight: true })).resolves.toBe("second");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("drains rejected work without rejecting", async () => {
    const registry = createSchedulerWorkRegistry();
    const failure = registry.run("watch-renewal", async () => {
      throw new Error("renewal failed");
    });

    await expect(failure).rejects.toThrow("renewal failed");
    await expect(registry.drain()).resolves.toBeUndefined();
  });
});
