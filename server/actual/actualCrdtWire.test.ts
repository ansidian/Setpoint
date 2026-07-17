import { describe, it, expect } from "vitest";
import { serializeValue, syncPayloadSummary, encodeSyncRequest, verifyEncodedSyncRequest } from "./actualCrdtWire.ts";

describe("actualCrdtWire", () => {
  it("serializes typed values", () => {
    expect(serializeValue(null)).toBe("0:");
    expect(serializeValue(5)).toBe("N:5");
    expect(serializeValue("x")).toBe("S:x");
  });
  it("summarizes messages by dataset", () => {
    expect(syncPayloadSummary([{ dataset: "a" }, { dataset: "a" }, { dataset: "b" }])).toEqual({ a: 2, b: 1 });
  });
  it("round-trips encode/verify", () => {
    const payload = { groupId: "g", cloudFileId: "f", since: "0", messages: [{ timestamp: "T", dataset: "d", row: "r", column: "c", value: "N:1" }] };
    expect(() => verifyEncodedSyncRequest(encodeSyncRequest(payload), payload)).not.toThrow();
  });
});
