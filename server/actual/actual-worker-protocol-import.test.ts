import { describe, expect, it } from "vitest";
import { isActualWorkerOperation, parseActualWorkerRequest } from "./actual-worker-protocol.ts";

describe("Actual transaction import worker protocol", () => {
  it("allowlists the grouped transaction import operation", () => {
    expect(isActualWorkerOperation("importTransactionGroups")).toBe(true);
    expect(parseActualWorkerRequest({
      id: "request-1",
      operation: "importTransactionGroups",
      args: ["owner-1", [], true],
    })).toEqual({
      id: "request-1",
      operation: "importTransactionGroups",
      args: ["owner-1", [], true],
    });
  });
});
