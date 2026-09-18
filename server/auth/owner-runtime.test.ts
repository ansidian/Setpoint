import { describe, expect, it } from "vitest";
import { createOwnerRuntimeGate } from "./owner-runtime.ts";

const owner = {
  singletonId: 1 as const,
  userId: "owner-1",
  claimedAt: 1,
};

describe("owner runtime gate", () => {
  it("rejects background admission before and after owner activation when disabled", () => {
    const gate = createOwnerRuntimeGate(() => { throw new Error("Disabled worker ran"); }, { enabled: false });
    expect(gate.startForOwner(null)).toBe(false);
    expect(gate.startForOwner(owner)).toBe(false);
    expect(gate.startForOwner(owner)).toBe(false);
  });

  it("does not start background work for an unclaimed instance", () => {
    const startedOwners: typeof owner[] = [];
    const start = (startedOwner: typeof owner) => { startedOwners.push(startedOwner); };
    const gate = createOwnerRuntimeGate(start);

    expect(gate.startForOwner(null)).toBe(false);
    expect(startedOwners).toEqual([]);
  });

  it("starts background work once when the owner becomes available", () => {
    const startedOwners: typeof owner[] = [];
    const start = (startedOwner: typeof owner) => { startedOwners.push(startedOwner); };
    const gate = createOwnerRuntimeGate(start);

    expect(gate.startForOwner(owner)).toBe(true);
    expect(gate.startForOwner(owner)).toBe(false);
    expect(startedOwners).toEqual([owner]);
  });
});
