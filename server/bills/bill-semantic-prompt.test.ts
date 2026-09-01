import { describe, expect, it } from "vitest";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "./bill-semantic-prompt.ts";

describe("shared bill semantic extraction instructions", () => {
  it("owns the stable first-pass semantic contract", () => {
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("statement_issued");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("payment_failed");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("event_confidence");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("account_last4 as exactly four digits");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("target_policy_key, target_confidence, and target_evidence to null");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("statement_balance, minimum_due, total_due, payment_amount, transaction_amount, refund_amount, order_total, subtotal, and other");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("A statement balance is canonical whenever present");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("never select minimum_due as amount_kind");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).toContain("return null amount and null amount_kind");
    expect(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS).not.toMatch(/unless[^.]*minimum/i);
  });
});
