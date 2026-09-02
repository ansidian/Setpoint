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
});
