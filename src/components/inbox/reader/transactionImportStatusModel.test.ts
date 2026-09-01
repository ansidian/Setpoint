import { describe, expect, it } from "vitest";
import { resolveTransactionImportStatus } from "./transactionImportStatusModel";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

function item(status: TransactionImportItem["status"], overrides: Partial<TransactionImportItem> = {}): TransactionImportItem {
  return {
    id: "item-1",
    runId: "run-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "Amazon order",
    internetMessageId: null,
    source: "amazon",
    parserVersion: "amazon-v1",
    externalId: "order-1",
    importedId: "amazon-order-1",
    date: "2026-07-20",
    amountCents: -1200,
    currency: "USD",
    payee: "Amazon",
    notes: "",
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "automatic",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [],
    financialPlan: null,
    planShadow: null,
    status,
    reconciliationStatus: null,
    attempts: 1,
    lastError: null,
    confirmedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("transaction import inbox status model", () => {
  it.each([
    ["added", "Added to Actual"],
    ["updated", "Updated in Actual"],
    ["already_present", "Already in Actual"],
    ["failed", "Couldn’t sync"],
    ["needs_review", "Needs review"],
    ["importing", "Syncing transaction"],
  ] as const)("projects %s consistently", (status, title) => {
    expect(resolveTransactionImportStatus([item(status)])?.title).toBe(title);
  });

  it("describes observe-mode results as no-write review", () => {
    expect(resolveTransactionImportStatus([
      item("ready", { automationMode: "observe", reconciliationStatus: "would_add" }),
    ])).toMatchObject({
      title: "Needs review",
      detail: "Observed safely; no Actual write was made.",
      review: true,
    });
  });
});
