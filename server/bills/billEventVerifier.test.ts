import { describe, expect, it, vi } from "vitest";
import { shouldVerifyBillEvent, verifyBillEvent } from "./billEventVerifier.ts";

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
});
