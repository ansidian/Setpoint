import { describe, expect, it, vi } from "vitest";
import type { BillExtractionProvider } from "../../shared/types/bills.ts";
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

  it("repairs an invalid selection from complete semantic candidates", async () => {
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
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected" },
    });
  });

  it("makes statement balance canonical even when another non-minimum amount was selected", async () => {
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
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected" },
    });
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

});
