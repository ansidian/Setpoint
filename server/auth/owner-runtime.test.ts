import { describe, expect, it, vi } from "vitest";
import { createOwnerRuntimeGate } from "./owner-runtime.ts";

const owner = {
  singletonId: 1 as const,
  userId: "owner-1",
  claimedAt: 1,
};

describe("owner runtime gate", () => {
  it("does not start background work for an unclaimed instance", () => {
    const start = vi.fn();
    const gate = createOwnerRuntimeGate(start);

    expect(gate.startForOwner(null)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts background work once when the owner becomes available", () => {
    const start = vi.fn();
    const gate = createOwnerRuntimeGate(start);

    expect(gate.startForOwner(owner)).toBe(true);
    expect(gate.startForOwner(owner)).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(owner);
  });
});
