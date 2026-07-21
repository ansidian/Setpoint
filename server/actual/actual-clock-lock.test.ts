import { describe, expect, it } from "vitest";
import { withActualClockLock } from "./actual-clock-lock.ts";

// Guards P1-4: the @actual-app/crdt process-global clock is mutated by both the
// lightweight bill-write path and the local-metadata refresh path. This mutex
// must make each path's clock read-modify-write atomic against the other.
describe("withActualClockLock", () => {
  it("serializes operations so their critical sections never interleave", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const op = (id: number) =>
      withActualClockLock(async () => {
        events.push(`start-${id}`);
        if (id === 1) {
          markFirstStarted();
          await firstCanFinish;
        }
        events.push(`end-${id}`);
      });

    const first = op(1);
    const second = op(2);

    await firstStarted;
    expect(events).toEqual(["start-1"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("returns the callback result and a rejection does not wedge the lock", async () => {
    await expect(
      withActualClockLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The next operation must still run after a prior rejection.
    await expect(withActualClockLock(async () => 42)).resolves.toBe(42);
  });
});
