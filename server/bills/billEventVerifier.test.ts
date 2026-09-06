import { describe, expect, it, vi } from "vitest";
import { shouldVerifyBillEvent, verifyBillEvent } from "./billEventVerifier.ts";
import { classifyFinancialEmail, hasFinancialSemanticConflict, shouldVerifyFinancialEmailType } from "./financialEmailClassificationPolicy.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

describe("bill event verifier", () => {
  it("audits other and low-confidence events but leaves confident events alone", () => {
    expect(shouldVerifyBillEvent({ amount: 42 })).toBe(true);
    expect(shouldVerifyBillEvent({ event_kind: "other", event_confidence: 0.99 })).toBe(true);
    expect(shouldVerifyBillEvent({ event_kind: "payment_scheduled", event_confidence: 0.65 })).toBe(true);
    expect(shouldVerifyBillEvent({ event_kind: "payment_scheduled", event_confidence: 0.9 })).toBe(true);
  });

  it("accepts a supported, evidenced correction without replacing other fields", async () => {
    const provider = {
      extract: vi.fn(async () => ({
        fields: {
          amount: 999,
          event_kind: "payment_cancelled" as const,
          event_confidence: 0.98,
          event_evidence: "You've cancelled autopay",
        },
        usage: { input_tokens: 10 },
      })),
    };
    const result = await verifyBillEvent({
      content: "Subject: Your autopay is scheduled. Body: You've cancelled autopay.",
      candidate: { amount: null, event_kind: "other", event_confidence: 0.9, event_evidence: "No payment due" },
      provider,
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      amount: null,
      event_kind: "payment_cancelled",
      event_confidence: 0.98,
      event_verification: { status: "corrected" },
    });
  });

  it("keeps the first pass when the audit cannot produce a supported event", async () => {
    const result = await verifyBillEvent({
      content: "Account notice",
      candidate: { event_kind: "other", event_confidence: 0.9 },
      provider: { extract: async () => ({ fields: { event_kind: "other", event_confidence: 1 }, usage: {} }) },
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      event_kind: "other",
      event_verification: { status: "kept_initial" },
    });
  });

  it("repairs a missing operation date that is explicit in the email", async () => {
    const content = "You redeemed $19.32 cash back. Order date 09/04/2026.";
    const provider = {
      extract: vi.fn(async () => ({
        fields: {
          event_kind: "reward" as const,
          event_confidence: 0.99,
          event_evidence: "Order date 09/04/2026",
          due_date: "2026-09-04",
          type: "income" as const,
          type_confidence: 0.99,
          type_evidence: "cash back",
        },
        usage: { input_tokens: 10 },
      })),
    };

    const result = await verifyBillEvent({
      content,
      candidate: {
        amount: 19.32,
        amount_kind: "transaction_amount",
        event_kind: "reward",
        event_confidence: 0.99,
        event_evidence: "cash back",
        due_date: null,
        type: "income",
        type_confidence: 0.99,
        type_evidence: "cash back",
      },
      provider,
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      amount: 19.32,
      event_kind: "reward",
      due_date: "2026-09-04",
      event_verification: { status: "corrected" },
    });
  });

  it("rejects a repaired operation date that is not present in the email", async () => {
    const result = await verifyBillEvent({
      content: "You redeemed $19.32 cash back.",
      candidate: {
        event_kind: "reward",
        event_confidence: 0.99,
        event_evidence: "cash back",
        due_date: null,
        type: "income",
        type_confidence: 0.99,
        type_evidence: "cash back",
      },
      provider: {
        extract: async () => ({
          fields: {
            event_kind: "reward",
            event_confidence: 0.99,
            event_evidence: "cash back",
            due_date: "2026-09-04",
          },
          usage: {},
        }),
      },
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate.due_date).toBeNull();
  });

  it("grounds an audited date in a separate source row without joining event excerpts", async () => {
    const result = await verifyBillEvent({
      content: "Purchase Confirmation\nTransaction number: RECEIPT-123\nTransaction date: 09/06/2026\nMerchant: Example Checkout Store\nTotal $30.00",
      candidate: { event_kind: "purchase", event_confidence: 0.99, event_evidence: "Purchase Confirmation",
        type: "expense", type_confidence: 0.99, type_evidence: "Purchase Confirmation", due_date: null,
        document_role: "merchant_receipt" },
      provider: { extract: async () => ({ fields: {
        event_kind: "purchase", event_confidence: 0.99, event_evidence: "Purchase Confirmation",
        type: "expense", type_confidence: 0.99, type_evidence: "Purchase Confirmation",
        due_date: "2026-09-06", document_role: "merchant_receipt",
      }, usage: {} }) },
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate).toMatchObject({ event_kind: "purchase", event_evidence: "Purchase Confirmation",
      document_role: "merchant_receipt", due_date: "2026-09-06", event_verification: { status: "corrected" } });
  });

  it("does not invent an operation year from a copyright footer", async () => {
    const result = await verifyBillEvent({
      content: "Your credit card statement is ready. Payment is due on 09/05. Copyright 2024 Example Bank.",
      candidate: { event_kind: "statement_issued", event_confidence: 0.99, event_evidence: "Your credit card statement is ready",
        type: "transfer", type_confidence: 0.99, type_evidence: "credit card statement", due_date: null },
      provider: { extract: async () => ({ fields: {
        event_kind: "statement_issued", event_confidence: 0.99, event_evidence: "Your credit card statement is ready",
        type: "transfer", type_confidence: 0.99, type_evidence: "credit card statement", due_date: "2024-09-05",
      }, usage: {} }) },
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate).toMatchObject({ event_kind: "statement_issued", due_date: null });
  });

  it("keeps grounded source and destination evidence when correcting an account transfer", async () => {
    const content = "Your transfer request is processing from PayPal balance to EXAMPLE BANK x-0001. Transaction ID: TEST-TRANSFER-REF-0001.";
    const result = await verifyBillEvent({
      content,
      candidate: { event_kind: "other", event_confidence: 0.9 },
      provider: {
        extract: async () => ({
          fields: {
            event_kind: "account_transfer_pending",
            event_confidence: 0.99,
            event_evidence: "transfer request is processing",
            type: "transfer",
            type_confidence: 0.99,
            type_evidence: "transfer request is processing",
            from_account_hint: "PayPal balance",
            from_account_hint_confidence: 0.99,
            to_account_hint: "EXAMPLE BANK x-0001",
            to_account_hint_confidence: 0.99,
            settlement_kind: "balance_to_bank",
            settlement_confidence: 0.99,
            settlement_evidence: "PayPal balance to EXAMPLE BANK x-0001",
            provider_reference: "TEST-TRANSFER-REF-0001",
            provider_reference_confidence: 0.99,
            provider_reference_evidence: "Transaction ID: TEST-TRANSFER-REF-0001",
          },
          usage: {},
        }),
      },
      providerId: "openai",
      model: "cheap-model",
    });

    expect(result.candidate).toMatchObject({
      event_kind: "account_transfer_pending",
      from_account_hint: "PayPal balance",
      to_account_hint: "EXAMPLE BANK x-0001",
      settlement_kind: "balance_to_bank",
      provider_reference: "TEST-TRANSFER-REF-0001",
    });
  });

  it("repairs a confident card-funded purchase misclassified as a card repayment", async () => {
    const content = "You paid Example Shop $30.00 on September 6, 2026. Payment method: Example Rewards Mastercard.";
    const result = await verifyBillEvent({
      content,
      candidate: {
        event_kind: "card_payment_completed", event_confidence: 0.99,
        event_evidence: "You paid Example Shop $30.00 on September 6, 2026",
        type: "expense", type_confidence: 0.99, type_evidence: "You paid Example Shop $30.00",
        due_date: "2026-09-10", amount: 30, amount_kind: "transaction_amount",
      },
      provider: { extract: async () => ({ fields: {
        event_kind: "purchase", event_confidence: 0.99,
        event_evidence: "You paid Example Shop $30.00 on September 6, 2026",
        type: "expense", type_confidence: 0.99, type_evidence: "You paid Example Shop $30.00",
        document_role: "processor_receipt", due_date: "2026-09-06",
        account_hint: "Example Rewards Mastercard", account_hint_confidence: 0.99,
      }, usage: {} }) },
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      event_kind: "purchase", type: "expense", amount: 30, due_date: "2026-09-06",
      account_hint: "Example Rewards Mastercard", document_role: "processor_receipt",
      type_verification: { status: "corrected", attempts: 1 },
    });
    expect(classifyFinancialEmail(result.candidate).intended).toBe("create_transaction");
  });

  it.each([false, true])("blocks an unrepaired semantic contradiction when the audit fails: %s", async (unavailable) => {
    const candidate: BillCandidate = {
      event_kind: "card_payment_completed", event_confidence: 0.99, event_evidence: "Payment to Example Shop",
      type: "expense", type_confidence: 0.99, type_evidence: "Payment to Example Shop", due_date: "2026-09-06",
    };
    const result = await verifyBillEvent({
      content: "Payment to Example Shop",
      candidate,
      provider: { extract: async () => {
        if (unavailable) throw new Error("provider unavailable");
        return { fields: candidate, usage: {} };
      } },
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate.type_verification?.status).toBe(unavailable ? "failed" : "kept_initial");
    expect(classifyFinancialEmail(result.candidate)).toMatchObject({
      classification: { reasons: ["semantic_event_ambiguous"] }, intended: null,
    });
  });

  it("clears the prior event's date when a corrected event has no grounded operation date", async () => {
    const result = await verifyBillEvent({
      content: "Your scheduled payment is now complete. The payment was applied to your credit card balance.",
      candidate: { event_kind: "payment_scheduled", event_confidence: 0.6, due_date: "2026-09-10", type: "transfer" },
      provider: { extract: async () => ({ fields: {
        event_kind: "card_payment_completed", event_confidence: 0.99,
        event_evidence: "The payment was applied to your credit card balance",
        type: "transfer", type_confidence: 0.99, type_evidence: "applied to your credit card balance",
        due_date: "2026-09-06",
      }, usage: {} }) },
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate).toMatchObject({ event_kind: "card_payment_completed", due_date: null });
  });
});

describe("financial event and ledger meaning", () => {
  it.each([0.1, 0.99])("rejects explicit contradictions independently of confidence %s", (confidence) => {
    for (const [event_kind, type] of [
      ["card_payment_completed", "expense"], ["purchase", "transfer"], ["refund", "expense"], ["payment_due", "income"],
    ] as const) {
      const candidate = { event_kind, type, event_confidence: confidence, type_confidence: confidence, type_evidence: "source evidence", due_date: "2026-09-06" };
      expect(hasFinancialSemanticConflict(candidate)).toBe(true);
      expect(shouldVerifyFinancialEmailType(candidate)).toBe(true);
      expect(shouldVerifyBillEvent(candidate)).toBe(true);
      expect(classifyFinancialEmail(candidate).intended).toBeNull();
    }
  });

  it.each(["card_payment_completed", "account_transfer_completed"] as const)("plans %s as a transfer only with supported type semantics", (event_kind) => {
    expect(classifyFinancialEmail({ event_kind, type: "transfer", type_confidence: 0.99, type_evidence: "Transfer completed" }).intended).toBe("create_transfer");
    for (const type of [null, "transfer"]) {
      const candidate = { event_kind, type };
      expect(classifyFinancialEmail(candidate).intended).toBeNull();
      expect(shouldVerifyFinancialEmailType(candidate)).toBe(true);
      expect(candidate.type).toBe(type);
    }
  });

  it("keeps pending movements unwritten apart from the approved external balance income policy", () => {
    expect(classifyFinancialEmail({ event_kind: "account_transfer_pending", type: "transfer" }).intended).toBe("no_write");
    expect(classifyFinancialEmail({ event_kind: "account_transfer_pending", type: "income" }).intended).toBe("no_write");
    for (const payee of ["Cashback", "/r/hardwareswap"]) {
      expect(classifyFinancialEmail({
        event_kind: "account_transfer_pending", type: "income", payee,
        from_account_hint: "PayPal balance", from_account_hint_confidence: 0.99,
        to_account_hint: "Example Bank x-0001", to_account_hint_confidence: 0.99,
      }).intended).toBe("create_transaction");
    }
  });
});
