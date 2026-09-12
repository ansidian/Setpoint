import { describe, expect, it, vi } from "vitest";
import type { BillCandidate, BillExtractionProvider } from "../../shared/types/bills.ts";
import {
  currencyValuesInText,
  shouldVerifyBillAmounts,
  verifyBillAmounts,
} from "./billAmountVerifier.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";

function providerWith(fields: Record<string, unknown>): BillExtractionProvider {
  return {
    extract: vi.fn(async () => ({ fields, usage: { input_tokens: 10 } })),
  } as BillExtractionProvider;
}

describe("semantic bill amount verifier", () => {
  const citiPurchase = "Subject: A transaction was made on your Costco Anywhere account\nFrom: alerts@info6.citi.com\n\n"
    + "You're receiving this email based on your custom alert settings.\n"
    + "The transaction made on your Costco Anywhere account exceeded $2.00.\nAmount: $10.99";
  const purchase: BillCandidate = {
    event_kind: "purchase", amount: 10.99, amount_kind: "transaction_amount",
    amount_candidates: [{ kind: "transaction_amount", value: 10.99, evidence: "Amount: $10.99" }],
  };

  it("accepts a Citi purchase with its configured notification threshold omitted", async () => {
    const result = await verifyBillAmounts({
      content: citiPurchase, candidate: purchase,
      provider: providerWith({}), providerId: "anthropic", model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)).toMatchObject({ amount: 10.99, kind: "transaction_amount" });
  });

  it("retains an actual $2 Citi purchase independently of the threshold", async () => {
    const result = await verifyBillAmounts({
      content: citiPurchase.replace("Amount: $10.99", "Amount: $2.00"),
      candidate: { ...purchase, amount: 2, amount_candidates: [{ kind: "transaction_amount", value: 2, evidence: "Amount: $2.00" }] },
      provider: providerWith({}), providerId: "anthropic", model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)).toMatchObject({ amount: 2, kind: "transaction_amount" });
  });

  it("accepts an audit that covers other monetary evidence while omitting the threshold", async () => {
    const result = await verifyBillAmounts({
      content: `${citiPurchase}\nService fee: $1.50`, candidate: purchase,
      provider: providerWith({ ...purchase, amount_candidates: [...purchase.amount_candidates!, { kind: "other", value: 1.5, evidence: "Service fee: $1.50" }] }),
      providerId: "anthropic", model: "test-model",
    });
    expect(result.candidate.amount_verification?.status).toBe("corrected");
    expect(selectSemanticBillAmount(result.candidate)?.amount).toBe(10.99);
  });

  it.each([
    ["a separate fee", `${citiPurchase}\nService fee: $2.00`],
    ["a genuine purchase", citiPurchase.replace("Amount: $10.99", "Amount: $2.00")],
    ["another sender", citiPurchase.replace("alerts@info6.citi.com", "bank@example.test")],
  ])("still requires the $2 amount for %s", async (_label, content) => {
    const result = await verifyBillAmounts({
      content, candidate: purchase,
      provider: providerWith(purchase), providerId: "anthropic", model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it.each([true, false])("cannot use the Citi notification threshold as the purchase amount (actual amount present: %s)", async (hasPurchase) => {
    const wrongAmount: BillCandidate = {
      ...purchase, amount: 2,
      amount_candidates: [
        { kind: "transaction_amount", value: 2, evidence: "exceeded $2.00" },
        { kind: "other", value: 10.99, evidence: "Amount: $10.99" },
      ],
    };
    const result = await verifyBillAmounts({
      content: hasPurchase ? citiPurchase : citiPurchase.replace("\nAmount: $10.99", ""), candidate: wrongAmount,
      provider: providerWith(wrongAmount), providerId: "anthropic", model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("corrects mislabeled statement evidence even when every currency value was already covered", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment | $40.00\nPlan adjusted balance | $0.00\nRemaining statement balance | $472.32\nAutopay On",
      candidate: {
        amount: 0,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment | $40.00" },
          { kind: "statement_balance", value: 0, evidence: "Remaining statement balance $0.00" },
          { kind: "payment_amount", value: 472.32, evidence: "Autopay On $472.32" },
        ],
      },
      provider: providerWith({
        amount: 472.32,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment | $40.00" },
          { kind: "other", value: 0, evidence: "Plan adjusted balance | $0.00" },
          { kind: "statement_balance", value: 472.32, evidence: "Remaining statement balance | $472.32" },
        ],
      }),
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate).toMatchObject({
      amount: 472.32,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected", initial_covered_count: 3, verified_covered_count: 3 },
    });
  });

  it("audits an inconsistent selection even when candidate coverage is complete", () => {
    expect(shouldVerifyBillAmounts(
      "Minimum payment $40.00. Statement balance $391.20.",
      {
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" },
        ],
      },
    )).toBe(true);
  });

  it("clears a scheduled payment selection when only minimum and statement obligations are evidenced", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Statement balance $391.20.",
      candidate: {
        event_kind: "payment_scheduled",
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" },
        ],
      },
      provider: providerWith({}),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: null,
      amount_kind: null,
      amount_verification: { status: "corrected" },
    });
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("preserves an explicit completed payment amount alongside an informational statement balance", async () => {
    const result = await verifyBillAmounts({
      content: "Payment amount $40.00. Statement balance $391.20.",
      candidate: {
        event_kind: "payment_completed",
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "payment_amount", value: 40, evidence: "Payment amount $40.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" },
        ],
      },
      provider: providerWith({}),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: 40,
      amount_kind: "payment_amount",
    });
    expect(result.candidate.amount_verification).toBeUndefined();
  });

  it("uses currency tokens only as a bounded completeness inventory", () => {
    expect(currencyValuesInText("Minimum $40.00, plan $0.00, balance 391.20 USD, duplicate $40")).toEqual([
      40,
      0,
      391.2,
    ]);
    expect(shouldVerifyBillAmounts("Only $40.00", {
      amount: 40,
      amount_kind: "transaction_amount",
      amount_candidates: [{ kind: "transaction_amount", value: 40 }],
    })).toBe(false);
  });

  it("audits one visible currency value when the first pass omitted it", async () => {
    const provider = providerWith({
      amount: 19.32,
      amount_kind: "transaction_amount",
      amount_candidates: [{ kind: "transaction_amount", value: 19.32, evidence: "You redeemed $19.32 cash back" }],
    });
    const result = await verifyBillAmounts({
      content: "You redeemed $19.32 cash back.",
      candidate: { event_kind: "reward", amount: null, amount_kind: null, amount_candidates: [] },
      provider,
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: 19.32,
      amount_kind: "transaction_amount",
      amount_verification: { status: "corrected", source_value_count: 1 },
    });
  });

  it.each([60, null])("audits an unsupported runtime candidate role instead of clearing cashback from %s", async (amount) => {
    const candidate = {
      event_kind: "reward", amount, amount_kind: amount == null ? null : "refund_amount",
      amount_candidates: [
        { kind: "reward", value: 60, evidence: "Cash amount $60.00" },
        { kind: "other", value: 6000, evidence: "Points redeeming 6,000 Points" },
      ],
    } as unknown as BillCandidate;
    const result = await verifyBillAmounts({
      content: "Cash amount $60.00. Points redeeming 6,000 Points.", candidate,
      provider: providerWith({ amount: 60, amount_kind: "transaction_amount", amount_candidates: [{ kind: "transaction_amount", value: 60, evidence: "Cash amount $60.00" }] }),
      providerId: "openai", model: "test-model",
    });
    expect(result.candidate).toMatchObject({ amount: 60, amount_kind: "transaction_amount", amount_verification: { status: "corrected" } });
    expect(result.usage).toEqual({ input_tokens: 10 });
  });

  it("audits an unsupported runtime scalar role instead of selecting a supported candidate locally", async () => {
    const result = await verifyBillAmounts({
      content: "Cash amount $60.00.",
      candidate: { event_kind: "reward", amount: 60, amount_kind: "reward", amount_candidates: [{ kind: "transaction_amount", value: 60, evidence: "Cash amount $60.00" }] } as unknown as BillCandidate,
      provider: providerWith({ amount: 60, amount_kind: "refund_amount", amount_candidates: [{ kind: "refund_amount", value: 60, evidence: "Cash amount $60.00" }] }),
      providerId: "openai", model: "test-model",
    });
    expect(result.candidate).toMatchObject({ amount: 60, amount_kind: "refund_amount", amount_verification: { status: "corrected" } });
    expect(result.usage).toEqual({ input_tokens: 10 });
  });

  it.each([
    { amount: null, amount_kind: null, amount_candidates: [{ kind: "reward", value: 60, evidence: "Cash amount $60.00" }] },
    { amount: 60, amount_kind: "transaction_amount", amount_candidates: [{ kind: "transaction_amount", value: 60, evidence: "Cash amount $60.00" }, { kind: "reward", value: 60, evidence: "Cash amount $60.00" }] },
    { amount: 60, amount_kind: "reward", amount_candidates: [{ kind: "transaction_amount", value: 60, evidence: "Cash amount $60.00" }] },
  ])("rejects verified runtime roles outside the schema: $amount_kind / $amount_candidates", async (fields) => {
    const result = await verifyBillAmounts({
      content: "Cash amount $60.00.", candidate: { event_kind: "reward", amount: null, amount_kind: null, amount_candidates: [] },
      provider: providerWith(fields), providerId: "openai", model: "test-model",
    });
    expect(result.candidate.amount_verification?.status).toBe("failed");
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("accepts a verifier that recovers a missing statement balance", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Plan balance $0.00. Statement balance $391.20.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
        payee_hint: "Example Bank",
      },
      provider: providerWith({
        amount: 391.2,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" },
          { kind: "other", value: 0, evidence: "Plan balance $0.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" },
        ],
      }),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      payee_hint: "Example Bank",
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: {
        status: "corrected",
        source_value_count: 3,
        initial_covered_count: 1,
        verified_covered_count: 3,
      },
    });
  });

  it("never restores a minimum-due selection when verification does not improve evidence", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Statement balance $391.20.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
      },
      provider: providerWith({
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
      }),
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.amount_kind).toBeNull();
    expect(result.candidate.amount_verification?.status).toBe("failed");
  });

  it("fails closed instead of restoring minimum due when the verifier is unavailable", async () => {
    const provider = { extract: vi.fn(async () => { throw new Error("offline"); }) } as BillExtractionProvider;
    const result = await verifyBillAmounts({
      content: "Minimum $40.00. Balance $391.20.",
      candidate: { amount: 40, amount_kind: "minimum_due", amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }] },
      provider,
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.amount_kind).toBeNull();
    expect(result.candidate.amount_verification?.status).toBe("failed");
  });

  it("keeps minimum due as evidence but never selects it when it is the only amount", async () => {
    const provider = {
      extract: vi.fn(async () => { throw new Error("single minimum should not trigger verification"); }),
    } as BillExtractionProvider;
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
      },
      provider,
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: null,
      amount_kind: null,
      amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
      amount_verification: { status: "corrected" },
    });
  });

  it("allows whitespace-normalized evidence and a genuine zero statement balance", async () => {
    const result = await verifyBillAmounts({
      content: "Statement balance |\n$0.00\nPayment amount | $472.32",
      candidate: {
        amount: 0,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "statement_balance", value: 0, evidence: "Statement balance | $0.00" },
          { kind: "payment_amount", value: 472.32, evidence: "Payment amount | $472.32" },
        ],
      },
      provider: providerWith({}),
      providerId: "openai",
      model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)?.amount).toBe(0);
    expect(result.candidate.amount_verification).toBeUndefined();
  });

  it.each([
    { evidence: "Statement balance $472.32", value: 472.32 },
    { evidence: "Remaining statement balance | $472.32", value: 472.31 },
    { evidence: "Minimum payment | $40.00...Remaining statement balance | $472.32", value: 472.32 },
  ])("rejects ungrounded audit corrections and retains evidence for review: $evidence / $value", async ({ evidence, value }) => {
    const candidate = {
      amount: 0,
      amount_kind: "statement_balance" as const,
      amount_candidates: [
        { kind: "minimum_due" as const, value: 40, evidence: "Minimum payment | $40.00" },
        { kind: "statement_balance" as const, value: 0, evidence: "Remaining statement balance $0.00" },
        { kind: "payment_amount" as const, value: 472.32, evidence: "Autopay On $472.32" },
      ],
    };
    const result = await verifyBillAmounts({
      content: "Minimum payment | $40.00\nPlan adjusted balance | $0.00\nRemaining statement balance | $472.32",
      candidate,
      provider: providerWith({
        amount: value,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment | $40.00" },
          { kind: "other", value: 0, evidence: "Plan adjusted balance | $0.00" },
          { kind: "statement_balance", value, evidence },
        ],
      }),
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount_candidates).toEqual(candidate.amount_candidates);
    expect(result.candidate.amount_verification?.status).toBe("failed");
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("keeps conflicting grounded statement balances unresolved when the audit cannot resolve them", async () => {
    const candidate = {
      amount: 472.32,
      amount_kind: "statement_balance" as const,
      amount_candidates: [
        { kind: "statement_balance" as const, value: 472.32, evidence: "Statement balance | $472.32" },
        { kind: "statement_balance" as const, value: 501, evidence: "Statement balance | $501.00" },
      ],
    };
    const result = await verifyBillAmounts({
      content: "Statement balance | $472.32\nStatement balance | $501.00",
      candidate,
      provider: providerWith(candidate),
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount_verification?.status).toBe("failed");
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("accepts a grounded payment-amount audit using the original event's amount roles", async () => {
    const result = await verifyBillAmounts({
      content: "Payment amount $40.00. Statement balance $391.20.",
      candidate: {
        event_kind: "card_payment_completed", amount: 391.2, amount_kind: "statement_balance",
        amount_candidates: [{ kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" }],
      },
      provider: providerWith({
        event_kind: "statement_issued", amount: 40, amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "payment_amount", value: 40, evidence: "Payment amount $40.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" },
        ],
      }),
      providerId: "openai", model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      event_kind: "card_payment_completed", amount: 40, amount_kind: "payment_amount",
      amount_verification: { status: "corrected" },
    });
  });

  it("keeps unselected informational amounts non-operational", async () => {
    const result = await verifyBillAmounts({
      content: "Potential savings $40.00.",
      candidate: { amount: null, amount_kind: null, amount_candidates: [{ kind: "other", value: 40, evidence: "Potential savings $40.00" }] },
      provider: providerWith({}), providerId: "openai", model: "test-model",
    });
    expect(result.candidate).toMatchObject({ amount: null, amount_kind: null });
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it.each(["missing", "grounded", "ungrounded"] as const)(
    "requires grounded coverage of a legal-footer amount while preserving the payment: %s",
    async (footerCoverage) => {
      const paymentEvidence = "You sent $74.49 USD to Synchrony Bank.";
      const footerEvidence = "you may be entitled to your money back plus a penalty of up to $1,000 and attorney's fees";
      const candidate: BillCandidate = {
        event_kind: "card_payment_completed", amount: 74.49, amount_kind: "payment_amount",
        amount_candidates: [{ kind: "payment_amount", value: 74.49, evidence: paymentEvidence }],
      };
      const result = await verifyBillAmounts({
        content: `${paymentEvidence}\n${footerEvidence}`,
        candidate,
        provider: providerWith({
          ...candidate,
          amount_candidates: [
            ...candidate.amount_candidates!,
            ...(footerCoverage === "missing" ? [] : [{
              kind: "other", value: 1000,
              evidence: footerCoverage === "grounded" ? footerEvidence : "A legal penalty of $1,000.",
            }]),
          ],
        }),
        providerId: "openai", model: "test-model",
      });

      expect(result.candidate.amount_verification).toMatchObject({
        status: footerCoverage === "grounded" ? "corrected" : "failed",
        source_value_count: 2, initial_covered_count: 1,
        verified_covered_count: footerCoverage === "missing" ? 1 : 2,
      });
      expect(selectSemanticBillAmount(result.candidate)).toEqual(footerCoverage === "grounded"
        ? { amount: 74.49, kind: "payment_amount", source: "semantic:payment_amount" }
        : null);
    },
  );

  it.each([null, 999])("audits competing payments without inventing a deterministic selection from %s", async (initialAmount) => {
    const content = "Previous payment $40.00. Current payment $75.00.";
    const candidate: BillCandidate = {
      event_kind: "card_payment_completed", amount: initialAmount,
      amount_kind: initialAmount == null ? null : "payment_amount",
      amount_candidates: [
        { kind: "payment_amount", value: 40, confidence: 0.99, evidence: "Previous payment $40.00" },
        { kind: "payment_amount", value: 75, confidence: 0.99, evidence: "Current payment $75.00" },
      ],
    };
    expect(shouldVerifyBillAmounts(content, candidate)).toBe(true);
    const result = await verifyBillAmounts({ content, candidate,
      provider: providerWith({ ...candidate, amount: null, amount_kind: null }), providerId: "openai", model: "test-model" });
    expect(result.candidate.amount_verification?.status).toBe("failed");
    expect(selectSemanticBillAmount(result.candidate)).toBeNull();
  });

  it("accepts an audited explicit payment selection corroborated among several grounded payments", async () => {
    const candidate: BillCandidate = {
      event_kind: "card_payment_completed", amount: null, amount_kind: null,
      amount_candidates: [
        { kind: "payment_amount", value: 40, confidence: 0.99, evidence: "Previous payment $40.00" },
        { kind: "payment_amount", value: 75, confidence: 0.98, evidence: "Current payment $75.00" },
      ],
    };
    const result = await verifyBillAmounts({ content: "Previous payment $40.00. Current payment $75.00.", candidate,
      provider: providerWith({ ...candidate, amount: 75, amount_kind: "payment_amount" }), providerId: "openai", model: "test-model" });
    expect(result.candidate).toMatchObject({ amount: 75, amount_kind: "payment_amount", amount_verification: { status: "corrected" } });
    expect(selectSemanticBillAmount(result.candidate)).toMatchObject({ amount: 75, kind: "payment_amount" });
  });

});

describe("canonical financial amount roles", () => {
  const amounts = [
    { kind: "payment_amount" as const, value: 40, confidence: 0.9 },
    { kind: "statement_balance" as const, value: 391.2, confidence: 0.99 },
    { kind: "minimum_due" as const, value: 25, confidence: 1 },
  ];

  it.each(["payment_scheduled", "payment_completed", "card_payment_completed", "account_transfer_completed"] as const)("uses the explicit payment amount for %s", (event_kind) => {
    expect(selectSemanticBillAmount({ event_kind, amount_kind: "statement_balance", amount: 391.2, amount_candidates: amounts }))
      .toMatchObject({ amount: 40, kind: "payment_amount" });
  });

  it.each(["statement_issued", "payment_due"] as const)("uses the statement balance for %s obligations", (event_kind) => {
    expect(selectSemanticBillAmount({ event_kind, amount_kind: "payment_amount", amount: 40, amount_candidates: amounts }))
      .toMatchObject({ amount: 391.2, kind: "statement_balance" });
  });

  it.each(["statement_balance", "total_due", "order_total", "transaction_amount", "refund_amount", "subtotal", "other"] as const)(
    "does not treat %s as the arranged amount of a scheduled payment, including a scalar fallback", (kind) => {
      const candidate: BillCandidate = { event_kind: "payment_scheduled", amount: 391.2, amount_kind: kind };
      expect(selectSemanticBillAmount(candidate)).toBeNull();
      expect(selectSemanticBillAmount({ ...candidate, amount_candidates: [{ kind, value: 391.2, confidence: 0.99 }] })).toBeNull();
    },
  );

  it("accepts an explicitly arranged minimum as a payment amount without selecting a minimum obligation", async () => {
    const candidate: BillCandidate = {
      event_kind: "payment_scheduled", amount: 40, amount_kind: "payment_amount",
      amount_candidates: [
        { kind: "minimum_due", value: 40, evidence: "Minimum payment due $40.00" },
        { kind: "payment_amount", value: 40, evidence: "Your minimum payment of $40.00 is scheduled for September 10, 2026" },
      ],
    };
    const result = await verifyBillAmounts({
      content: "Minimum payment due $40.00. Your minimum payment of $40.00 is scheduled for September 10, 2026.",
      candidate, provider: providerWith({}), providerId: "openai", model: "test-model",
    });
    expect(selectSemanticBillAmount(result.candidate)).toMatchObject({ amount: 40, kind: "payment_amount" });
    expect(selectSemanticBillAmount({ event_kind: "payment_scheduled", amount: 40, amount_kind: "payment_amount" }))
      .toMatchObject({ amount: 40, kind: "payment_amount" });
  });

  it.each(["payment_completed", "card_payment_completed", "account_transfer_completed"] as const)("does not borrow a statement balance for %s with no paid amount", (event_kind) => {
    expect(selectSemanticBillAmount({ event_kind, amount_kind: "statement_balance", amount: 391.2, amount_candidates: amounts.slice(1) })).toBeNull();
  });

  it("never selects a minimum payment, including a scalar fallback", () => {
    expect(selectSemanticBillAmount({ event_kind: "payment_scheduled", amount: 25, amount_kind: "minimum_due" })).toBeNull();
    expect(selectSemanticBillAmount({ event_kind: "payment_scheduled", amount_candidates: amounts.slice(2) })).toBeNull();
    expect(selectSemanticBillAmount({ amount: null, amount_kind: "payment_amount" })).toBeNull();
  });

  it.each(["payment_amount", "transaction_amount", "order_total"] as const)("does not choose between distinct %s values using confidence or source order", (kind) => {
    const amount_candidates = [
      { kind, value: 40, confidence: 0.99 },
      { kind, value: 75, confidence: 0.98 },
    ];
    const candidate: BillCandidate = { event_kind: kind === "payment_amount" ? "payment_completed" : "purchase", amount_candidates };
    expect(selectSemanticBillAmount(candidate)).toBeNull();
    expect(selectSemanticBillAmount({ ...candidate, amount_candidates: [...amount_candidates].reverse() })).toBeNull();
    expect(selectSemanticBillAmount({ ...candidate, amount: 75, amount_kind: kind })).toMatchObject({ amount: 75, kind });
    expect(selectSemanticBillAmount({ ...candidate, amount: 99, amount_kind: kind })).toBeNull();
  });

  it("preserves unresolved payment priority over a selected statement balance", () => {
    expect(selectSemanticBillAmount({ event_kind: "payment_scheduled", amount: 391.2, amount_kind: "statement_balance",
      amount_candidates: [...amounts, { kind: "payment_amount", value: 75, confidence: 0.99 }] })).toBeNull();
  });

  it("treats repeated evidence of the same payment value as one canonical amount", () => {
    expect(selectSemanticBillAmount({ event_kind: "payment_completed", amount_candidates: [
      { kind: "payment_amount", value: 40, confidence: 0.99 },
      { kind: "payment_amount", value: 40, confidence: 0.98 },
    ] })).toMatchObject({ amount: 40, kind: "payment_amount" });
  });
});
