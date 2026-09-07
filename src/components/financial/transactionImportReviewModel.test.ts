import { describe, expect, it } from "vitest";
import {
  formatImportAmount,
  itemToConfirmation,
} from "./transactionImportReviewModel";
import type { TransactionImportItem } from "../../../shared/types/transaction-imports";

function item(overrides: Partial<TransactionImportItem> = {}): TransactionImportItem {
  return {
    id: "item-1",
    runId: "run-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "You paid Demo Merchant $12.00",
    internetMessageId: null,
    source: "paypal",
    parserVersion: "paypal-v1",
    externalId: "external-1",
    importedId: "paypal-external-1",
    date: "2026-07-20",
    amountCents: -1200,
    currency: "USD",
    payee: "Demo Merchant",
    notes: "Receipt",
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "observe",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [],
    financialPlan: null,
    planShadow: null,
    status: "ready",
    reconciliationStatus: "would_add",
    attempts: 1,
    lastError: null,
    confirmedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("transaction import review model", () => {
  it("projects signed amounts and editable confirmations", () => {
    const items = [item(), item({ id: "item-2", amountCents: 500 })];
    expect(formatImportAmount(-700)).toBe("-$7.00");
    expect(itemToConfirmation(items[0]!, { payee: "Corrected" })).toMatchObject({
      itemId: "item-1",
      amountCents: -1200,
      payee: "Corrected",
      actualAccountId: "account-1",
    });
  });
});
