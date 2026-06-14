import { describe, expect, it } from "vitest";
import { withActualClockLock } from "./actual-clock-lock.js";

// Guards P1-4: the @actual-app/crdt process-global clock is mutated by both the
// lightweight bill-write path and the local-metadata refresh path. This mutex
// must make each path's clock read-modify-write atomic against the other.
describe("withActualClockLock", () => {
  it("serializes operations so their critical sections never interleave", async () => {
    const events = [];
    const op = (id) =>
      withActualClockLock(async () => {
        events.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end-${id}`);
      });

    await Promise.all([op(1), op(2)]);

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
