import { describe, it, expect } from "vitest";
import { serializeValue, encodeSyncRequest, verifyEncodedSyncRequest } from "./actualCrdtWire.ts";

describe("actualCrdtWire", () => {
  it("serializes typed values", () => {
    expect(serializeValue(null)).toBe("0:");
    expect(serializeValue(5)).toBe("N:5");
    expect(serializeValue("x")).toBe("S:x");
  });
  it("round-trips encode/verify", () => {
    const payload = { groupId: "g", cloudFileId: "f", since: "0", messages: [{ timestamp: "T", dataset: "d", row: "r", column: "c", value: "N:1" }] };
    expect(() => verifyEncodedSyncRequest(encodeSyncRequest(payload), payload)).not.toThrow();
  });
});
