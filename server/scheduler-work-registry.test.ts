import { describe, expect, it } from "vitest";
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
    let runCount = 0;
    const task = () => {
      runCount += 1;
      if (runCount === 1) {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve("second");
    };

    const first = registry.run("triage", task, { singleFlight: true });
    const duplicate = registry.run("triage", task, { singleFlight: true });
    expect(duplicate).toBe(first);
    expect(runCount).toBe(1);

    resolveFirst?.("first");
    await first;
    await Promise.resolve();

    await expect(registry.run("triage", task, { singleFlight: true })).resolves.toBe("second");
    expect(runCount).toBe(2);
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
