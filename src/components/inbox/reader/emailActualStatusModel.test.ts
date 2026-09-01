import { describe, expect, it } from "vitest";
import { resolveEmailActualStatusSource } from "./emailActualStatusModel";

describe("resolveEmailActualStatusSource", () => {
  it("prefers durable transaction-import success over a generic Actual verification failure", () => {
    expect(resolveEmailActualStatusSource({
      transactionImportItems: [{ status: "added", automationMode: "automatic" }],
      billResolution: { status: "error", actualStatus: null },
    })).toBe("transaction_import");
  });

  it("keeps one source-specific status throughout the transaction-import lifecycle", () => {
    for (const status of ["queued", "needs_review", "failed"] as const) {
      expect(resolveEmailActualStatusSource({
        transactionImportItems: [{ status, automationMode: "automatic" }],
        billResolution: {
          status: "resolved",
          actualStatus: { status: "already_recorded" },
        },
      })).toBe("transaction_import");
    }
  });

  it("falls back to statement reconciliation when no import status is actionable", () => {
    expect(resolveEmailActualStatusSource({
      transactionImportItems: [],
      billResolution: {
        status: "resolved",
        actualStatus: { status: "already_scheduled" },
      },
    })).toBe("actual");
  });

  it("renders nothing when neither source has a status", () => {
    expect(resolveEmailActualStatusSource({
      transactionImportItems: [],
      billResolution: { status: "idle", actualStatus: null },
    })).toBeNull();
  });
});
