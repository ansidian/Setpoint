import { Timestamp } from "@actual-app/crdt";
import { describe, expect, it } from "vitest";
import { actualWriteDateInt, computeActualSyncSince } from "./actualWriteModel.ts";

describe("actual write model", () => {
  it("accepts valid Actual dates and rejects invalid serialized values", () => {
    expect(actualWriteDateInt("2026-05-15")).toBe(20260515);
    expect(() => actualWriteDateInt("not-a-date")).toThrow();
    expect(() => actualWriteDateInt("")).toThrow();
    expect(() => actualWriteDateInt(null)).toThrow();
  });

  it("uses the safest available CRDT sync cursor", () => {
    expect(computeActualSyncSince({ lastSyncedTimestamp: "T-synced", lastPushedTimestamp: "T-pushed" })).toBe("T-synced");
    expect(computeActualSyncSince({ lastPushedTimestamp: "T-pushed" })).toBe("T-pushed");
    expect(computeActualSyncSince({})).toBe(new Timestamp(0, 0, "0").toString());
  });
});
